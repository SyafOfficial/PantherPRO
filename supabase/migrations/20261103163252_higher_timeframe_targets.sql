begin;
create or replace function public.tick_volume_roadblocks(snapshot jsonb,as_of bigint)
returns table(timeframe text,kind text,price numeric)
language sql immutable security invoker set search_path='' as $$
 with bars as (
 select s->>'timeframe' f,(b->>'opened_at_server_raw')::bigint t,(b->>'high')::numeric h,(b->>'low')::numeric l
 from jsonb_array_elements(snapshot->'series') s cross join lateral jsonb_array_elements(s->'candles') b
 where s->>'timeframe' in ('M5','M15','M30','H1','H4') and (b->>'opened_at_server_raw')::bigint+
 case s->>'timeframe' when 'M5' then 300 when 'M15' then 900 when 'M30' then 1800 when 'H1' then 3600 else 14400 end<=as_of
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

create or replace function public.apply_tick_volume(export_time timestamptz,proposal jsonb) returns jsonb
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
 where timeframe in ('M5','M15','M30') and kind=case when buy then 'support' else 'resistance' end and case when buy then price<entry_price else price>entry_price end
 order by case when buy then -price else price end limit 1;
 select array_agg(price order by case when buy then price else -price end) into targets from (
 select price from public.tick_volume_roadblocks(feed.snapshot,stamp+300)
 where timeframe in ('M30','H1','H4') and kind=case when buy then 'resistance' else 'support' end and case when buy then price>entry_price else price<entry_price end
 group by price order by case when buy then price else -price end limit 3) q;
 if stop_price is null or coalesce(array_length(targets,1),0)<>3 then return jsonb_build_object('published',0,'reason','missing_roadblocks');end if;
 if stop_price is distinct from (proposal->'risk'->>'stop')::numeric
 or targets[1] is distinct from (proposal->'risk'->'targets'->>0)::numeric
 or targets[2] is distinct from (proposal->'risk'->'targets'->>1)::numeric
 or targets[3] is distinct from (proposal->'risk'->'targets'->>2)::numeric then raise exception 'Structural levels mismatch';end if;
 reason='Independent tick-volume momentum M5 '||(case when buy then 'BUY' else 'SELL' end)||
 ': completed candle volume '||round(ratio,2)||'x prior 20-bar mean; directional body and close confirmed. SL uses intact M5/M15/M30 support/resistance; TP1-TP3 use intact M30/H1/H4 resistance for BUY or support for SELL. One price dollar equals 10 pips. SL requires exit-side M5 close beyond level. Observed quotes, no broker fill; no guaranteed outcome.';
 insert into public.signals(instrument,direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,engine_version)
 values('XAUUSD',proposal->>'direction',entry_price,entry_price,entry_price,stop_price,targets[1],targets[2],targets[3],reason,'vip','mt5',event_id,event_id,feed.exported_at,null,'TICK_VOLUME','M5','tick-volume-momentum-v1') returning id into new_id;
 update public.signals set status='active',approved_by=policy.approved_by,published_at=now(),pricing_source='Vestrado MT5: observed feed, no broker fill' where id=new_id;
 insert into public.automatic_engine_tracking(signal_id,last_snapshot,last_m5_open) values(new_id,export_time,stamp);
 insert into public.notification_outbox(event_key,signal_id,event_type,access) values(new_id::text||':active',new_id,'signal.active','vip');
 insert into public.audit_logs(actor_id,action,entity_id,details) values(policy.approved_by,'engine.tick_volume_published',new_id,jsonb_build_object('execution','hypothetical','volume_ratio',ratio,'confirmation_open',stamp));
 update public.tick_volume_policy set last_result=jsonb_build_object('published',1,'signal_id',new_id,'observed_at',now()) where singleton;
 return jsonb_build_object('published',1,'signal_id',new_id);
end; $$;

create or replace function public.apply_automatic_engine(export_time timestamptz,plans jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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

commit;
