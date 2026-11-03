begin;
create table public.tick_volume_policy (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 updated_at timestamptz not null default now(),last_result jsonb
);
insert into public.tick_volume_policy(singleton) values(true);
alter table public.tick_volume_policy enable row level security;
revoke all on public.tick_volume_policy from public,anon,authenticated;
grant all on public.tick_volume_policy to service_role;
grant select on public.tick_volume_policy to authenticated;
create policy tick_policy_admin on public.tick_volume_policy for select to authenticated using(public.is_admin());
alter table public.signals drop constraint signals_strategy_check;
alter table public.signals add constraint signals_strategy_check check(strategy in ('QM','QMTR','BOS','CHOCH','TRENDLINE','TICK_VOLUME'));
alter table public.signals drop constraint signals_timeframe_check;
alter table public.signals add constraint signals_timeframe_check check(timeframe in ('M5','M15','M30','H1','H4','D1','W1','MN1'));
alter table public.signals add constraint tick_method_frame check((
 (strategy is distinct from 'TICK_VOLUME' and timeframe is distinct from 'M5') or
 (strategy='TICK_VOLUME' and timeframe='M5' and higher_timeframe is null and engine_version='tick-volume-momentum-v1')
) is true);
alter table public.signals drop constraint engine_entry_zone;
alter table public.signals add constraint engine_entry_zone check(
 (engine_version is null and entry_low is null and entry_high is null) or
 (engine_version='vestrado-structure-v1' and source='mt5' and entry_low>0 and entry_high>=entry_low and entry between entry_low and entry_high and entry_high-entry_low<=8) or
 (engine_version='tick-volume-momentum-v1' and source='mt5' and entry_low=entry and entry_high=entry and access='vip')
);
create or replace function public.audit_signal_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.observation_quote_id is not null or new.observation_entry is not null or new.observation_started_at is not null or new.last_quote_id is not null or new.stop_observed_at is not null or new.reconciliation_state<>'not_started' or new.status<>'draft' or new.approved_by is not null or new.published_at is not null or new.closed_at is not null or new.tp1_hit_at is not null or new.tp2_hit_at is not null or new.tp3_hit_at is not null or new.outcome is not null or new.pricing_source is not null or new.max_favorable_movement is not null or new.break_even then raise exception 'Signals must start as unapproved drafts without outcomes';end if;
 new.created_at=now();new.updated_at=now();new.version=1;
 if auth.role()='service_role' and (new.source='tradingview' or (new.source='mt5' and (new.engine_version='vestrado-structure-v1' or (new.engine_version='tick-volume-momentum-v1' and exists(select 1 from public.tick_volume_policy where singleton and enabled))) and exists(select 1 from public.automatic_engine_policy where singleton and enabled and approved_by is not null))) and new.created_by is null and new.source_event_id is not null and new.source_fingerprint is not null then
  insert into public.audit_logs(actor_id,action,entity_id) values(null,'signal.ingested',new.id);
 else
  if not public.is_admin() or new.source<>'manual' or new.created_by is distinct from auth.uid() or new.source_event_id is not null or new.source_fingerprint is not null or new.source_timestamp is not null then raise exception 'Administrator manual draft required';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('signal-create:'||auth.uid()::text));
  if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='signal.created' and created_at>now()-interval '1 minute')>=20 then raise exception 'Signal creation rate limit exceeded';end if;
  insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'signal.created',new.id);
 end if;return new;
end;
$$;

revoke all on function public.audit_signal_insert() from public,anon,authenticated;

-- Recompute intact confirmed support/resistance from actual completed broker candles.
create function public.tick_volume_roadblocks(snapshot jsonb,as_of bigint)
returns table(timeframe text,kind text,price numeric)
language sql immutable security invoker set search_path='' as $$
 with bars as (
 select s->>'timeframe' f,(b->>'opened_at_server_raw')::bigint t,(b->>'high')::numeric h,(b->>'low')::numeric l
 from jsonb_array_elements(snapshot->'series') s cross join lateral jsonb_array_elements(s->'candles') b
 where s->>'timeframe' in ('M5','M15','M30') and (b->>'opened_at_server_raw')::bigint+
 case s->>'timeframe' when 'M5' then 300 when 'M15' then 900 else 1800 end<=as_of
 ), numbered as (
 select *,row_number() over(partition by f order by t) n from bars
 ), pivots as (
 select b.f,b.n,b.h,b.l from numbered b where
 (select count(*) from numbered x where x.f=b.f and x.n between b.n-2 and b.n+2)=5
 )
 select p.f,'resistance',p.h from pivots p where
 not exists(select 1 from numbered x where x.f=p.f and x.n between p.n-2 and p.n+2 and x.n<>p.n and x.h>=p.h)
 and not exists(select 1 from numbered x where x.f=p.f and x.n>p.n+2 and x.h>=p.h)
 union all
 select p.f,'support',p.l from pivots p where
 not exists(select 1 from numbered x where x.f=p.f and x.n between p.n-2 and p.n+2 and x.n<>p.n and x.l<=p.l)
 and not exists(select 1 from numbered x where x.f=p.f and x.n>p.n+2 and x.l<=p.l);
$$;
revoke all on function public.tick_volume_roadblocks(jsonb,bigint) from public,anon,authenticated;
grant execute on function public.tick_volume_roadblocks(jsonb,bigint) to service_role;

-- Explicit invoker privileges; service_role bypasses RLS, clients retain existing policies.
grant select on public.profiles to service_role;
grant select,insert,update on public.signals to service_role;
grant select,insert on public.notification_outbox to service_role;
grant insert on public.audit_logs to service_role;
create function public.apply_tick_volume(export_time timestamptz,proposal jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare feed public.mt5_bridge_latest;policy public.automatic_engine_policy;new_id uuid;buy boolean;entry_price numeric;
 stop_price numeric;targets numeric[];stamp bigint;latest jsonb;history jsonb;average_volume numeric;ratio numeric;body numeric;span numeric;closing_wick numeric;reason text;event_id text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('panther-auto-engine'));
 select * into policy from public.automatic_engine_policy where singleton for share;
 if not policy.enabled or not exists(select 1 from public.tick_volume_policy where singleton and enabled)
 or not exists(select 1 from public.profiles where id=policy.approved_by and role='admin') then
 return jsonb_build_object('published',0,'reason','paused');end if;
 select * into feed from public.mt5_bridge_latest where source='vestrado' for share;
 if not found or export_time is distinct from feed.exported_at or feed.received_at<now()-interval '30 seconds'
 or feed.exported_at<now()-interval '30 seconds' or feed.exported_at>now()+interval '5 seconds'
 or (feed.snapshot->>'server_time_raw')::bigint-(feed.snapshot->'quote'->>'last_tick_time_raw')::bigint not between 0 and 60
 then return jsonb_build_object('published',0,'reason','stale_or_superseded');end if;
 if proposal is null or proposal->>'status' is distinct from 'risk_ready' then
 update public.tick_volume_policy set last_result=jsonb_build_object('published',0,'reason',coalesce(proposal->>'reason','no_candidate'),'observed_at',now()) where singleton;
 return jsonb_build_object('published',0,'reason','no_candidate');end if;
 if proposal->>'version' is distinct from 'tick-volume-momentum-v1' or proposal->>'direction' not in ('BUY','SELL')
 or proposal->>'candidateId' is null or proposal->>'candidateId' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid tick proposal';end if;
 event_id=proposal->>'candidateId';
 if exists(select 1 from public.signals where source='mt5' and source_event_id=event_id) then return jsonb_build_object('published',0,'reason','duplicate');end if;
 select jsonb_agg(b order by (b->>'opened_at_server_raw')::bigint) into history from (
 select b from jsonb_array_elements(feed.snapshot->'series') s cross join lateral jsonb_array_elements(s->'candles') b
 where s->>'timeframe'='M5' order by (b->>'opened_at_server_raw')::bigint desc limit 21) q;
 if jsonb_array_length(history) is distinct from 21 then raise exception 'Tick baseline unavailable';end if;
 latest=history->20;stamp=(latest->>'opened_at_server_raw')::bigint;
 if (feed.snapshot->>'server_time_raw')::bigint-(stamp+300) not between 0 and 299
 or (proposal->>'closedAt')::bigint is distinct from stamp+300 then raise exception 'Stale tick confirmation';end if;
 if exists(select 1 from jsonb_array_elements(history) with ordinality a(b,n) where (b->>'tick_volume')::numeric<=0
 or (b->>'opened_at_server_raw')::bigint<>stamp-(21-n)*300) then raise exception 'Invalid tick history';end if;
 select avg((b->>'tick_volume')::numeric) into average_volume from jsonb_array_elements(history) with ordinality a(b,n) where n<=20;
 ratio=(latest->>'tick_volume')::numeric/average_volume;
 body=abs((latest->>'close')::numeric-(latest->>'open')::numeric);span=(latest->>'high')::numeric-(latest->>'low')::numeric;
 buy=proposal->>'direction'='BUY';
 closing_wick=case when buy then (latest->>'high')::numeric-(latest->>'close')::numeric else (latest->>'close')::numeric-(latest->>'low')::numeric end;
 if ratio<1.5 or span<=0 or body/span<0.6 or closing_wick/span>0.2
 or (buy and (latest->>'close')::numeric<=(latest->>'open')::numeric)
 or (not buy and (latest->>'close')::numeric>=(latest->>'open')::numeric) then raise exception 'Tick confirmation rejected';end if;
 -- Exit-side M5 evidence is mandatory so the existing SL monitor can observe SELL safely.
 if not buy and not exists(select 1 from jsonb_array_elements(coalesce(feed.snapshot->'ask_m5','[]'::jsonb)) b where (b->>'opened_at_server_raw')::bigint=stamp) then
 return jsonb_build_object('published',0,'reason','sell_ask_history_missing');end if;
 entry_price=case when buy then (feed.snapshot->'quote'->>'ask')::numeric else (feed.snapshot->'quote'->>'bid')::numeric end;
 if abs(entry_price-(proposal->>'entry')::numeric)>0.000001 then return jsonb_build_object('published',0,'reason','quote_changed');end if;
 select price into stop_price from public.tick_volume_roadblocks(feed.snapshot,stamp+300)
 where kind=case when buy then 'support' else 'resistance' end and case when buy then price<entry_price else price>entry_price end
 order by case when buy then -price else price end limit 1;
 select array_agg(price order by case when buy then price else -price end) into targets from (
 select price from public.tick_volume_roadblocks(feed.snapshot,stamp+300)
 where kind=case when buy then 'resistance' else 'support' end and case when buy then price>entry_price else price<entry_price end
 group by price order by case when buy then price else -price end limit 3) q;
 if stop_price is null or coalesce(array_length(targets,1),0)<>3 then return jsonb_build_object('published',0,'reason','missing_roadblocks');end if;
 if stop_price is distinct from (proposal->'risk'->>'stop')::numeric
 or targets[1] is distinct from (proposal->'risk'->'targets'->>0)::numeric
 or targets[2] is distinct from (proposal->'risk'->'targets'->>1)::numeric
 or targets[3] is distinct from (proposal->'risk'->'targets'->>2)::numeric then raise exception 'Structural levels mismatch';end if;
 reason='Independent tick-volume momentum M5 '||(case when buy then 'BUY' else 'SELL' end)||
 ': completed candle volume '||round(ratio,2)||'x prior 20-bar mean; directional body and close confirmed. SL/TP use intact confirmed M5/M15/M30 support/resistance. SL requires exit-side M5 close beyond level. Observed quotes, no broker fill; no guaranteed outcome.';
 insert into public.signals(instrument,direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,engine_version)
 values('XAUUSD',proposal->>'direction',entry_price,entry_price,entry_price,stop_price,targets[1],targets[2],targets[3],reason,'vip','mt5',event_id,event_id,feed.exported_at,null,'TICK_VOLUME','M5','tick-volume-momentum-v1') returning id into new_id;
 update public.signals set status='active',approved_by=policy.approved_by,published_at=now(),pricing_source='Vestrado MT5: observed feed, no broker fill' where id=new_id;
 insert into public.automatic_engine_tracking(signal_id,last_snapshot,last_m5_open) values(new_id,export_time,stamp);
 insert into public.notification_outbox(event_key,signal_id,event_type,access) values(new_id::text||':active',new_id,'signal.active','vip');
 insert into public.audit_logs(actor_id,action,entity_id,details) values(policy.approved_by,'engine.tick_volume_published',new_id,jsonb_build_object('execution','hypothetical','volume_ratio',ratio,'confirmation_open',stamp));
 update public.tick_volume_policy set last_result=jsonb_build_object('published',1,'signal_id',new_id,'observed_at',now()) where singleton;
 return jsonb_build_object('published',1,'signal_id',new_id);
end; $$;
revoke all on function public.apply_tick_volume(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_tick_volume(timestamptz,jsonb) to service_role;
commit;
