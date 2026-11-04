alter table public.automatic_engine_tracking add column if not exists last_tick_msc bigint;
-- One-time 50-pip instruction. Does not move a broker stop or claim realized profit.
create or replace function public.apply_automatic_engine(export_time timestamptz,plans jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare feed public.mt5_bridge_latest;policy public.automatic_engine_policy;item record;plan jsonb;new_id uuid;existing_id uuid;quote_price numeric;buy boolean;event text;stamp bigint;m5 jsonb;observed numeric;level numeric;which integer;published integer=0;events integer=0;was_gap boolean; tick record; signal_key uuid; initial_tick bigint; original_snapshot jsonb; original_export timestamptz;
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
  signal_key=item.signal_id; initial_tick=item.last_tick_msc;
  original_snapshot=feed.snapshot; original_export=feed.exported_at;
  for tick in
   select q, ord from (
    select value q, ordinality ord from jsonb_array_elements(coalesce(feed.snapshot->'quote_ticks','[]'::jsonb)) with ordinality
    union all select feed.snapshot->'quote', 5001::bigint
   ) quotes
   where (q->>'last_tick_time_msc_raw')::bigint>coalesce(initial_tick,
    ((original_snapshot->>'server_time_raw')::bigint*1000-extract(epoch from (original_export-item.last_snapshot))*1000)::bigint)
   order by (q->>'last_tick_time_msc_raw')::bigint,ord
  loop
   select t.*,s.direction,s.entry,s.entry_low,s.entry_high,s.stop_loss,s.tp1,s.tp2,s.tp3,s.tp1_hit_at,s.tp2_hit_at,s.tp3_hit_at,s.break_even,s.access into item
    from public.automatic_engine_tracking t join public.signals s on s.id=t.signal_id
    where t.signal_id=signal_key and t.state='tracking' and s.status='active';
   if not found then exit;end if;
   feed.snapshot=jsonb_set(original_snapshot,'{quote}',tick.q);
   feed.exported_at=least(original_export,original_export-make_interval(secs => (original_snapshot->>'server_time_raw')::double precision-(tick.q->>'last_tick_time_msc_raw')::double precision/1000));
   update public.automatic_engine_tracking set last_tick_msc=(tick.q->>'last_tick_time_msc_raw')::bigint where signal_id=signal_key;
  buy=item.direction='BUY';m5=null;
  quote_price=case when buy then greatest((feed.snapshot->'quote'->>'bid')::numeric,(feed.snapshot->'quote'->>'ask')::numeric) else least((feed.snapshot->'quote'->>'bid')::numeric,(feed.snapshot->'quote'->>'ask')::numeric) end;
  if item.break_even and item.be_zone_armed and ((buy and (feed.snapshot->'quote'->>'bid')::numeric<=item.entry_high) or (not buy and (feed.snapshot->'quote'->>'ask')::numeric>=item.entry_low)) then
   update public.signals set status='closed',closed_at=now(),reconciliation_state='stopped' where id=item.signal_id;
   update public.automatic_engine_tracking set state='closed',last_snapshot=original_export where signal_id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access,payload)
   values(item.signal_id::text||':engine-be-return',item.signal_id,'signal.be_hit',item.access,
    jsonb_build_object('entry_low',item.entry_low,'entry_high',item.entry_high,'observed_price',quote_price,'observed_at',feed.exported_at,'observation_only',true)) on conflict do nothing;
   insert into public.audit_logs(action,entity_id,details) values('engine.be_zone_return_observed',item.signal_id,jsonb_build_object('observed_price',quote_price,'broker_execution_verified',false));
   events=events+1;continue;
  end if;
  -- Any observed Bid/Ask touch counts; never wait for an M5 close.
  if (buy and least((feed.snapshot->'quote'->>'bid')::numeric,(feed.snapshot->'quote'->>'ask')::numeric)<=item.stop_loss)
     or (not buy and greatest((feed.snapshot->'quote'->>'bid')::numeric,(feed.snapshot->'quote'->>'ask')::numeric)>=item.stop_loss) then
   update public.signals set status='closed',closed_at=now(),stop_observed_at=feed.exported_at,reconciliation_state='stopped' where id=item.signal_id;
   update public.automatic_engine_tracking set state='closed',last_snapshot=original_export where signal_id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access,payload)
   values(item.signal_id::text||':engine-sl',item.signal_id,'signal.stop_hit',item.access,
    jsonb_build_object('basis','bid_or_ask_touch','observed_at',feed.exported_at,'bid',feed.snapshot->'quote'->'bid','ask',feed.snapshot->'quote'->'ask','observation_only',true)) on conflict do nothing;
   insert into public.audit_logs(action,entity_id,details) values('engine.sl_observed',item.signal_id,jsonb_build_object('basis','bid_or_ask_touch','execution','hypothetical'));
   events=events+1;continue;
  end if;
  -- Management uses the published entry, including exactly $5 = 50 pips.
  -- Quote evidence can trigger the alert without waiting for a completed M5 candle.
  observed=greatest(0,case when buy then quote_price-item.entry else item.entry-quote_price end);
  update public.signals set max_favorable_movement=greatest(coalesce(max_favorable_movement,0),observed) where id=item.signal_id;
  if not item.break_even and observed>=5 then
   update public.signals set break_even=true where id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access,payload)
   values(item.signal_id::text||':engine-be',item.signal_id,'signal.break_even',item.access,
    jsonb_build_object('threshold_pips',50,'entry',item.entry,'observed_price',quote_price,'observed_at',feed.exported_at,'instruction_only',true)) on conflict do nothing;
   events=events+1;
  end if;
  -- Only arm after the 50-pip instruction AND a quote beyond the entire zone.
  -- A wide entry zone must not produce a false BE while price is still rising inside it.
  if (item.break_even or observed>=5) and ((buy and (feed.snapshot->'quote'->>'bid')::numeric>item.entry_high) or (not buy and (feed.snapshot->'quote'->>'ask')::numeric<item.entry_low)) then
   update public.automatic_engine_tracking set be_zone_armed=true where signal_id=item.signal_id;
  end if;
  for which in 1..3 loop
   level=case which when 1 then item.tp1 when 2 then item.tp2 else item.tp3 end;
   if (case which when 1 then item.tp1_hit_at when 2 then item.tp2_hit_at else item.tp3_hit_at end) is null and ((buy and quote_price>=level) or (not buy and quote_price<=level)) then
    update public.signals set tp1_hit_at=case when which=1 then feed.exported_at else tp1_hit_at end,tp2_hit_at=case when which=2 then feed.exported_at else tp2_hit_at end,tp3_hit_at=case when which=3 then feed.exported_at else tp3_hit_at end where id=item.signal_id;
    insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':engine-tp'||which,item.signal_id,'signal.tp'||which,item.access) on conflict do nothing;
    events=events+1;
   end if;
  end loop;
  if (buy and quote_price>=item.tp3) or (not buy and quote_price<=item.tp3) then
   update public.signals set status='closed',closed_at=now() where id=item.signal_id;
   update public.automatic_engine_tracking set state='closed' where signal_id=item.signal_id;
  end if;
  update public.automatic_engine_tracking set last_snapshot=original_export,last_m5_open=greatest(last_m5_open,coalesce(stamp,last_m5_open)) where signal_id=item.signal_id;
  end loop;
  feed.snapshot=original_snapshot;feed.exported_at=original_export;
  update public.automatic_engine_tracking set last_snapshot=export_time where signal_id=signal_key;
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
   -- All three targets must match the nearest intact M30/H1/H4 directional levels.
   if (select array_agg(price order by case when buy then price else -price end) from (
     select price from public.tick_volume_roadblocks(feed.snapshot,stamp+300)
     where timeframe in ('M30','H1','H4') and kind=case when buy then 'resistance' else 'support' end
     and case when buy then price>(plan->>'zoneHigh')::numeric else price<(plan->>'zoneLow')::numeric end
     group by price order by case when buy then price else -price end limit 3
   ) targets) is distinct from array[(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric]
   then raise exception 'Higher timeframe targets mismatch';end if;
   if not buy and not exists(select 1 from jsonb_array_elements(coalesce(feed.snapshot->'ask_m5','[]'::jsonb)) c where (c->>'opened_at_server_raw')::bigint=stamp) then raise exception 'SELL requires actual ask M5 evidence';end if;
   insert into public.signals(instrument,direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,higher_timeframe,engine_version)
   values('XAUUSD',plan->>'direction',quote_price,(plan->>'zoneLow')::numeric,(plan->>'zoneHigh')::numeric,(plan->>'stop')::numeric,(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric,plan->>'reason','public','mt5',plan->>'sourceEventId',plan->>'sourceEventId',feed.exported_at,null,plan->>'method',plan->>'timeframe',plan->>'higherTimeframe',policy.version) returning id into new_id;
   update public.signals set status='active',approved_by=policy.approved_by,published_at=now(),pricing_source='Vestrado MT5: observed feed, no broker fill' where id=new_id;
   insert into public.automatic_engine_tracking(signal_id,last_snapshot,last_m5_open,last_tick_msc) values(new_id,export_time,stamp,(feed.snapshot->'quote'->>'last_tick_time_msc_raw')::bigint);
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



create or replace function public.ingest_mt5_snapshot(snapshot jsonb,fingerprint text,export_time timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing text;latest_time timestamptz;monitor_result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if fingerprint !~ '^[a-f0-9]{64}$' or snapshot->>'schema' is distinct from 'panther.mt5.snapshot.v1' or snapshot->>'symbol' is distinct from 'XAUUSD.V' or snapshot->>'provider' is distinct from 'Vestrado MT5' or snapshot->>'bar_time_basis' is distinct from 'broker_server' or snapshot->>'execution_enabled' is distinct from 'false' or pg_column_size(snapshot)>2097152 or export_time is null or export_time>now()+interval '5 seconds' or export_time<now()-interval '30 seconds' then raise exception 'Invalid snapshot';end if;
 if to_char(export_time at time zone 'UTC','YYYY.MM.DD HH24:MI:SS') is distinct from snapshot->>'exported_at_utc' then raise exception 'Export time mismatch';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('panther-auto-engine'));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('panther-mt5-vestrado'));
 select r.fingerprint into existing from public.mt5_bridge_receipts r where r.exported_at=export_time;
 if found then
  if existing is distinct from fingerprint then raise exception using errcode='P0409',message='Conflicting snapshot';end if;
  return jsonb_build_object('duplicate',true);
 end if;
 select exported_at into latest_time from public.mt5_bridge_latest where source='vestrado';
 if latest_time is not null and export_time<=latest_time then raise exception using errcode='P0409',message='Out of order snapshot';end if;
 if (select count(*) from public.mt5_bridge_receipts where received_at>now()-interval '1 minute')>=90 then raise exception using errcode='P0429',message='Bridge rate limit';end if;
 insert into public.mt5_bridge_receipts values(export_time,fingerprint,now());
 insert into public.mt5_bridge_latest(source,snapshot,exported_at,received_at) values('vestrado',snapshot,export_time,now()) on conflict(source) do update set snapshot=excluded.snapshot,exported_at=excluded.exported_at,received_at=excluded.received_at;
 delete from public.mt5_bridge_receipts where received_at<now()-interval '24 hours';
 select public.apply_automatic_engine(export_time,'[]'::jsonb) into monitor_result;
 return jsonb_build_object('duplicate',false,'monitor_processed',coalesce((monitor_result->>'processed')::boolean,false),'monitor_events',coalesce((monitor_result->>'events')::integer,0));
end;
$$;

create or replace function public.prepare_push_deliveries(batch_size integer default 20) returns integer language plpgsql security definer set search_path='' as $$
declare item public.notification_outbox;total integer=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_outbox where prepared_at is null and state='pending' order by case when event_type='signal.active' then 0 when event_type like 'signal.%' then 1 else 2 end,created_at,id for update skip locked limit least(greatest(batch_size,1),100) loop
  insert into public.notification_deliveries(outbox_id,subscription_id,state)
  select item.id,s.id,'pending' from public.push_subscriptions s where public.notification_allowed(item.id,s.id) on conflict(outbox_id,subscription_id) do nothing;
  update public.notification_outbox set prepared_at=now(),state=case when exists(select 1 from public.notification_deliveries where outbox_id=item.id) then 'processing' else 'delivered' end where id=item.id;
  total=total+1;
 end loop;return total;
end;
$$;

create or replace function public.claim_push_deliveries(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.notification_deliveries;result jsonb='[]';token uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_deliveries where (state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<now()) order by (select case when o.event_type='signal.active' then 0 when o.event_type like 'signal.%' then 1 else 2 end from public.notification_outbox o where o.id=outbox_id),next_attempt_at,id for update skip locked limit least(greatest(batch_size,1),100) loop
  if item.attempts>=5 then update public.notification_deliveries set state='failed',error_code='attempts_exhausted' where id=item.id;continue;end if;
  if not public.notification_allowed(item.outbox_id,item.subscription_id) then update public.notification_deliveries set state='skipped',error_code='no_longer_eligible' where id=item.id;continue;end if;
  token=gen_random_uuid();
  update public.notification_deliveries set state='processing',attempts=attempts+1,lease_token=token,lease_until=now()+interval '2 minutes' where id=item.id;
  result=result||(select jsonb_build_array(jsonb_build_object('id',item.id,'outbox_id',item.outbox_id,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,'lease_token',token,'attempts',item.attempts+1,'event_type',o.event_type,'signal_id',o.signal_id,'calendar_event_id',o.calendar_event_id)) from public.push_subscriptions s,public.notification_outbox o where s.id=item.subscription_id and o.id=item.outbox_id);
 end loop;return result;
end;
$$;
