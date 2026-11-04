-- Advance an M5 cursor only when that signal actually observes its exit-side candle.
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
   select q,ord,kind,raw_msc from (
    select value q,ordinality ord,'quote' kind,(value->>'last_tick_time_msc_raw')::bigint raw_msc
     from jsonb_array_elements(coalesce(original_snapshot->'quote_ticks','[]'::jsonb)) with ordinality
    union all select original_snapshot->'quote',5001::bigint,'quote',(original_snapshot->'quote'->>'last_tick_time_msc_raw')::bigint
    union all
    select c,0::bigint,'m5',((c->>'opened_at_server_raw')::bigint+300)*1000
     from jsonb_array_elements(case when item.direction='BUY' then
      coalesce((select x->'candles' from jsonb_array_elements(original_snapshot->'series') x where x->>'timeframe'='M5'),'[]'::jsonb)
      else coalesce(original_snapshot->'ask_m5','[]'::jsonb) end) c
   ) observations
   where (kind='quote' and raw_msc>coalesce(initial_tick,
    ((original_snapshot->>'server_time_raw')::bigint*1000-extract(epoch from (original_export-item.last_snapshot))*1000)::bigint))
    or (kind='m5' and (q->>'opened_at_server_raw')::bigint>item.last_m5_open
     and (original_snapshot->>'server_time_raw')::bigint-raw_msc/1000 between 0 and 300)
   order by raw_msc,ord
  loop
   select t.*,s.direction,s.entry,s.entry_low,s.entry_high,s.stop_loss,s.tp1,s.tp2,s.tp3,s.tp1_hit_at,s.tp2_hit_at,s.tp3_hit_at,s.break_even,s.access into item
    from public.automatic_engine_tracking t join public.signals s on s.id=t.signal_id
    where t.signal_id=signal_key and t.state='tracking' and s.status='active';
   if not found then exit;end if;
   buy=item.direction='BUY';
   if tick.kind='m5' then
    stamp=(tick.q->>'opened_at_server_raw')::bigint;
    update public.automatic_engine_tracking set last_m5_open=stamp where signal_id=signal_key;
    if (buy and (tick.q->>'close')::numeric<=item.stop_loss) or (not buy and (tick.q->>'close')::numeric>=item.stop_loss) then
     observed=(tick.q->>'close')::numeric;
     feed.exported_at=least(original_export,original_export-make_interval(secs => (original_snapshot->>'server_time_raw')::double precision-tick.raw_msc::double precision/1000));
     update public.signals set status='closed',closed_at=now(),stop_observed_at=feed.exported_at,reconciliation_state='stopped' where id=signal_key;
     update public.automatic_engine_tracking set state='closed',last_snapshot=original_export where signal_id=signal_key;
     insert into public.notification_outbox(event_key,signal_id,event_type,access,payload)
      values(signal_key::text||':engine-sl',signal_key,'signal.stop_hit',item.access,
       jsonb_build_object('basis',case when buy then 'bid_m5_close' else 'ask_m5_close' end,'close',observed,'broker_open',stamp,'observed_at',feed.exported_at,'observation_only',true)) on conflict do nothing;
     insert into public.audit_logs(action,entity_id,details) values('engine.sl_observed',signal_key,jsonb_build_object('basis',case when buy then 'bid_m5_close' else 'ask_m5_close' end,'close',observed,'execution','hypothetical'));
     events=events+1;
    end if;
    continue;
   end if;
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
  update public.automatic_engine_tracking set last_snapshot=original_export where signal_id=item.signal_id;
  end loop;
  feed.snapshot=original_snapshot;feed.exported_at=original_export;
  update public.automatic_engine_tracking set last_snapshot=export_time where signal_id=signal_key;
 end loop;
 if policy.enabled and exists(select 1 from public.profiles where id=policy.approved_by and role='admin') then
  for plan in select value from jsonb_array_elements(plans) loop
   if plan->>'version' is distinct from policy.version or plan->>'provider' is distinct from 'Vestrado MT5' or plan->>'sourceEventId' !~ '^[a-f0-9]{64}$' or plan->>'timeframe' not in ('M15','M30','H1','H4','W1','MN1') or plan->>'method' not in ('QM','BOS','CHOCH','TRENDLINE') or plan->>'direction' not in ('BUY','SELL') then raise exception 'Invalid automatic plan metadata';end if;
   if exists(select 1 from public.retired_signal_keys where source='mt5' and source_event_id=plan->>'sourceEventId') then continue;end if;
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
