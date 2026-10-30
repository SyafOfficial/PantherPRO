begin;
create table public.automatic_engine_policy (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 version text not null default 'vestrado-structure-v1' check(version='vestrado-structure-v1'),
 approved_by uuid references public.profiles(id),updated_at timestamptz not null default now(),last_snapshot_processed timestamptz,last_result jsonb
);
insert into public.automatic_engine_policy(singleton) values(true);
alter table public.automatic_engine_policy enable row level security;
revoke all on public.automatic_engine_policy from public,anon,authenticated;
grant select on public.automatic_engine_policy to authenticated;
grant all on public.automatic_engine_policy to service_role;
create policy engine_policy_admin on public.automatic_engine_policy for select to authenticated using(public.is_admin());
create function public.set_automatic_engine(enabled_value boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Verified administrator required';end if;
 update public.automatic_engine_policy set enabled=enabled_value,approved_by=auth.uid(),updated_at=now() where singleton;
 insert into public.audit_logs(actor_id,action,details) values(auth.uid(),'engine.policy_changed',jsonb_build_object('enabled',enabled_value,'version','vestrado-structure-v1'));
end;
$$;
revoke all on function public.set_automatic_engine(boolean) from public,anon;
grant execute on function public.set_automatic_engine(boolean) to authenticated;
alter table public.signals add column entry_low numeric;
alter table public.signals add column entry_high numeric;
alter table public.signals add column engine_version text;
alter table public.signals add constraint engine_entry_zone check(
 (engine_version is null and entry_low is null and entry_high is null) or
 (engine_version='vestrado-structure-v1' and source='mt5' and entry_low>0 and entry_high>=entry_low and entry between entry_low and entry_high and entry_high-entry_low<=8)
);
create table public.automatic_engine_tracking (
 signal_id uuid primary key references public.signals(id),last_snapshot timestamptz not null,
 last_m5_open bigint not null,state text not null default 'tracking' check(state in ('tracking','gap','closed'))
);
alter table public.automatic_engine_tracking enable row level security;
revoke all on public.automatic_engine_tracking from public,anon,authenticated;
grant select on public.automatic_engine_tracking to authenticated;
grant all on public.automatic_engine_tracking to service_role;
create policy engine_tracking_admin on public.automatic_engine_tracking for select to authenticated using(public.is_admin());

create or replace function public.audit_signal_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.observation_quote_id is not null or new.observation_entry is not null or new.observation_started_at is not null or new.last_quote_id is not null or new.stop_observed_at is not null or new.reconciliation_state<>'not_started' or new.status<>'draft' or new.approved_by is not null or new.published_at is not null or new.closed_at is not null or new.tp1_hit_at is not null or new.tp2_hit_at is not null or new.tp3_hit_at is not null or new.outcome is not null or new.pricing_source is not null or new.max_favorable_movement is not null or new.break_even then raise exception 'Signals must start as unapproved drafts without outcomes';end if;
 new.created_at=now();new.updated_at=now();new.version=1;
 if auth.role()='service_role' and (new.source='tradingview' or (new.source='mt5' and new.engine_version='vestrado-structure-v1' and exists(select 1 from public.automatic_engine_policy where singleton and enabled and approved_by is not null))) and new.created_by is null and new.source_event_id is not null and new.source_fingerprint is not null then
  insert into public.audit_logs(actor_id,action,entity_id) values(null,'signal.ingested',new.id);
 else
  if not public.is_admin() or new.source<>'manual' or new.created_by is distinct from auth.uid() or new.source_event_id is not null or new.source_fingerprint is not null or new.source_timestamp is not null then raise exception 'Administrator manual draft required';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('signal-create:'||auth.uid()::text));
  if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='signal.created' and created_at>now()-interval '1 minute')>=20 then raise exception 'Signal creation rate limit exceeded';end if;
  insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'signal.created',new.id);
 end if;return new;
end;
$$;
create function public.protect_engine_prices() returns trigger language plpgsql set search_path='' as $$
begin
 if old.engine_version is not null then
  if new.entry is distinct from old.entry or new.entry_low is distinct from old.entry_low or new.entry_high is distinct from old.entry_high or new.stop_loss is distinct from old.stop_loss or new.tp1 is distinct from old.tp1 or new.tp2 is distinct from old.tp2 or new.tp3 is distinct from old.tp3 or new.engine_version is distinct from old.engine_version or new.observation_quote_id is distinct from old.observation_quote_id then raise exception 'Automatic plan prices are immutable; close the plan instead';end if;
 end if;
 return new;
end;
$$;
create trigger protect_engine_prices before update on public.signals for each row execute function public.protect_engine_prices();
revoke all on function public.protect_engine_prices() from public,anon,authenticated;
create function public.apply_automatic_engine(export_time timestamptz,plans jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare feed public.mt5_bridge_latest;policy public.automatic_engine_policy;item record;plan jsonb;new_id uuid;existing_id uuid;quote_price numeric;buy boolean;event text;stamp bigint;m5 jsonb;observed numeric;level numeric;which integer;published integer=0;events integer=0;was_gap boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if jsonb_typeof(plans) is distinct from 'array' or jsonb_array_length(plans)>24 then raise exception 'Invalid plan batch';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('panther-auto-engine'));
 select * into feed from public.mt5_bridge_latest where source='vestrado' for share;
 if not found or export_time is distinct from feed.exported_at or feed.received_at<now()-interval '30 seconds' or feed.exported_at<now()-interval '30 seconds' or feed.exported_at>now()+interval '5 seconds' then return jsonb_build_object('processed',false,'reason','stale_or_superseded');end if;
 if (feed.snapshot->>'server_time_raw')::bigint-(feed.snapshot->'quote'->>'last_tick_time_raw')::bigint not between 0 and 60 then return jsonb_build_object('processed',false,'reason','stale_tick');end if;
 select * into policy from public.automatic_engine_policy where singleton for share;
 -- Existing observations continue when new publication is paused. Gaps never invent touches.
 for item in select t.*,s.direction,s.entry,s.entry_low,s.entry_high,s.stop_loss,s.tp1,s.tp2,s.tp3,s.tp1_hit_at,s.tp2_hit_at,s.tp3_hit_at,s.break_even,s.access from public.automatic_engine_tracking t join public.signals s on s.id=t.signal_id where t.state='tracking' and s.status='active' for update of t,s loop
  if export_time<=item.last_snapshot then continue;end if;
  if export_time-item.last_snapshot>interval '90 seconds' then
   update public.automatic_engine_tracking set state='gap',last_snapshot=export_time where signal_id=item.signal_id;
   update public.signals set reconciliation_state='gap',reasoning=reasoning||' Monitoring paused after a data gap; unobserved touches are unknown.' where id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':engine-gap',item.signal_id,'signal.modified',item.access) on conflict do nothing;
   continue;
  end if;
  buy=item.direction='BUY';m5=null;
  if buy then select candle into m5 from jsonb_array_elements(feed.snapshot->'series') series cross join lateral jsonb_array_elements(series->'candles') candle where series->>'timeframe'='M5' order by (candle->>'opened_at_server_raw')::bigint desc limit 1;
  else select candle into m5 from jsonb_array_elements(coalesce(feed.snapshot->'ask_m5','[]'::jsonb)) candle order by (candle->>'opened_at_server_raw')::bigint desc limit 1;end if;
  stamp=(m5->>'opened_at_server_raw')::bigint;
  if stamp is null or (feed.snapshot->>'server_time_raw')::bigint-(stamp+300)>300 then
   update public.automatic_engine_tracking set state='gap',last_snapshot=export_time where signal_id=item.signal_id;
   update public.signals set reconciliation_state='gap',reasoning=reasoning||' Monitoring paused: completed exit-side M5 candle is unavailable.' where id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':engine-gap',item.signal_id,'signal.modified',item.access) on conflict do nothing;
   continue;
  end if;
  if stamp>item.last_m5_open and (feed.snapshot->>'server_time_raw')::bigint-(stamp+300) between 0 and 300 then
   if (buy and (m5->>'close')::numeric<item.stop_loss) or (not buy and (m5->>'close')::numeric>item.stop_loss) then
    update public.signals set status='closed',closed_at=now(),stop_observed_at=feed.exported_at,reconciliation_state='stopped' where id=item.signal_id;
    update public.automatic_engine_tracking set state='closed',last_m5_open=stamp,last_snapshot=export_time where signal_id=item.signal_id;
    insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':engine-sl',item.signal_id,'signal.stop_hit',item.access) on conflict do nothing;
    insert into public.audit_logs(action,entity_id,details) values('engine.sl_observed',item.signal_id,jsonb_build_object('basis',case when buy then 'bid_m5_close' else 'ask_m5_close' end,'broker_open',stamp,'execution','hypothetical'));
    events=events+1;continue;
   end if;
  end if;
  quote_price=case when buy then (feed.snapshot->'quote'->>'bid')::numeric else (feed.snapshot->'quote'->>'ask')::numeric end;
  for which in 1..3 loop
   level=case which when 1 then item.tp1 when 2 then item.tp2 else item.tp3 end;
   if (case which when 1 then item.tp1_hit_at when 2 then item.tp2_hit_at else item.tp3_hit_at end) is null and ((buy and quote_price>=level) or (not buy and quote_price<=level)) then
    update public.signals set tp1_hit_at=case when which=1 then feed.exported_at else tp1_hit_at end,tp2_hit_at=case when which=2 then feed.exported_at else tp2_hit_at end,tp3_hit_at=case when which=3 then feed.exported_at else tp3_hit_at end where id=item.signal_id;
    insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':engine-tp'||which,item.signal_id,'signal.tp'||which,item.access) on conflict do nothing;
    events=events+1;
   end if;
  end loop;
  if not item.break_even and ((buy and quote_price-item.entry_high>5) or (not buy and item.entry_low-quote_price>5)) then
   update public.signals set break_even=true where id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':engine-be',item.signal_id,'signal.break_even',item.access) on conflict do nothing;events=events+1;
  end if;
  if (buy and quote_price>=item.tp3) or (not buy and quote_price<=item.tp3) then
   update public.signals set status='closed',closed_at=now() where id=item.signal_id;
   update public.automatic_engine_tracking set state='closed' where signal_id=item.signal_id;
  end if;
  update public.automatic_engine_tracking set last_snapshot=export_time,last_m5_open=greatest(last_m5_open,coalesce(stamp,last_m5_open)) where signal_id=item.signal_id;
 end loop;
 if policy.enabled and exists(select 1 from public.profiles where id=policy.approved_by and role='admin') then
  for plan in select value from jsonb_array_elements(plans) loop
   if plan->>'version' is distinct from policy.version or plan->>'provider' is distinct from 'Vestrado MT5' or plan->>'sourceEventId' !~ '^[a-f0-9]{64}$' or plan->>'timeframe' not in ('M15','M30','H1','H4','W1','MN1') or plan->>'method' not in ('QM','BOS','CHOCH','TRENDLINE') or plan->>'direction' not in ('BUY','SELL') then raise exception 'Invalid automatic plan metadata';end if;
   select id into existing_id from public.signals where source='mt5' and source_event_id=plan->>'sourceEventId';if found then continue;end if;
   buy=plan->>'direction'='BUY';quote_price=case when buy then (feed.snapshot->'quote'->>'ask')::numeric else (feed.snapshot->'quote'->>'bid')::numeric end;
   if exists(select 1 from unnest(array[(plan->>'entry')::numeric,(plan->>'zoneLow')::numeric,(plan->>'zoneHigh')::numeric,(plan->>'stop')::numeric,(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric]) n where n is null or n<=0 or n::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid automatic prices';end if;
   if (plan->>'zoneHigh')::numeric-(plan->>'zoneLow')::numeric not between 0 and 8 or quote_price not between (plan->>'zoneLow')::numeric and (plan->>'zoneHigh')::numeric or abs(quote_price-(plan->>'entry')::numeric)>0.000001 or jsonb_array_length(plan->'targets')<>3 or length(plan->>'reason') not between 20 and 2000 then raise exception 'Automatic zone/entry invalid';end if;
   if abs((plan->>'stop')::numeric-(case when buy then (plan->>'zoneLow')::numeric-3 else (plan->>'zoneHigh')::numeric+3 end))>0.000001 then raise exception 'Automatic SL buffer invalid';end if;
   if (buy and (plan->'targets'->>0)::numeric<=(plan->>'zoneHigh')::numeric) or (not buy and (plan->'targets'->>0)::numeric>=(plan->>'zoneLow')::numeric) then raise exception 'Targets must be ahead of the entire zone';end if;
   stamp=(plan->>'confirmationOpenedServer')::bigint;
   if (feed.snapshot->>'server_time_raw')::bigint-(stamp+300) not between 0 and 300 then raise exception 'Confirmation is stale';end if;
   if not buy and not exists(select 1 from jsonb_array_elements(coalesce(feed.snapshot->'ask_m5','[]'::jsonb)) c where (c->>'opened_at_server_raw')::bigint=stamp) then raise exception 'SELL requires actual ask M5 evidence';end if;
   insert into public.signals(instrument,direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,higher_timeframe,engine_version)
   values('XAUUSD',plan->>'direction',quote_price,(plan->>'zoneLow')::numeric,(plan->>'zoneHigh')::numeric,(plan->>'stop')::numeric,(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric,plan->>'reason','public','mt5',plan->>'sourceEventId',plan->>'sourceEventId',feed.exported_at,null,plan->>'method',plan->>'timeframe',plan->>'higherTimeframe',policy.version) returning id into new_id;
   update public.signals set status='active',approved_by=policy.approved_by,published_at=now(),pricing_source='Vestrado MT5: observed feed, no broker fill' where id=new_id;
   insert into public.automatic_engine_tracking(signal_id,last_snapshot,last_m5_open) values(new_id,export_time,stamp);
   insert into public.notification_outbox(event_key,signal_id,event_type,access) values(new_id::text||':active',new_id,'signal.active','public');
   insert into public.audit_logs(actor_id,action,entity_id,details) values(policy.approved_by,'engine.signal_published',new_id,jsonb_build_object('policy_version',policy.version,'breakout_broker_time',plan->'breakoutOpenedServer','confirmation_broker_time',stamp,'execution','hypothetical'));
   published=published+1;
  end loop;
 end if;
 update public.automatic_engine_policy set last_snapshot_processed=export_time,last_result=jsonb_build_object('published',published,'events',events) where singleton;
 return jsonb_build_object('processed',true,'published',published,'events',events,'enabled',policy.enabled);
end;
$$;
revoke all on function public.apply_automatic_engine(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_automatic_engine(timestamptz,jsonb) to service_role;
commit;
