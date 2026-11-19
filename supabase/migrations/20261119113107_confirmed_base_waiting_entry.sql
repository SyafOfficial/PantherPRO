begin;
alter table public.automatic_engine_policy add column base_entry_mode text check(base_entry_mode is null or base_entry_mode='base-waiting-v1');
alter table public.signals add column entry_phase text check(entry_phase in ('waiting','entered','cancelled'));
alter table public.signals add column entry_activated_at timestamptz;
alter table public.signals add column entry_wait_reason text;
create table public.automatic_entry_waits(
 signal_id uuid primary key references public.signals(id) on delete cascade,
 plan jsonb not null,expires_broker bigint not null,last_snapshot timestamptz not null,
 last_tick_msc bigint not null,created_at timestamptz not null default now()
);
alter table public.automatic_entry_waits enable row level security;
revoke all on public.automatic_entry_waits from public,anon,authenticated,service_role;
grant select on public.automatic_entry_waits to service_role;
-- Only the observed pending-to-active transition may replace the indicative entry.
create or replace function public.protect_engine_prices() returns trigger language plpgsql set search_path='' as $$
begin
 if old.engine_version is not null then
  if new.entry is distinct from old.entry and not (auth.role()='service_role' and old.status='pending' and old.entry_phase='waiting' and new.status='active' and new.entry_phase='entered' and new.entry_activated_at is not null and new.entry between old.entry_low and old.entry_high) then raise exception 'Automatic plan prices are immutable; close the plan instead';end if;
  if new.entry_low is distinct from old.entry_low or new.entry_high is distinct from old.entry_high or new.stop_loss is distinct from old.stop_loss or new.tp1 is distinct from old.tp1 or new.tp2 is distinct from old.tp2 or new.tp3 is distinct from old.tp3 or new.engine_version is distinct from old.engine_version or new.observation_quote_id is distinct from old.observation_quote_id then raise exception 'Automatic plan prices are immutable; close the plan instead';end if;
 end if;return new;
end;$$;
-- No performance row is created until an actual observed entry activates the setup.
do $$declare d text;begin
 d=pg_get_functiondef('public.capture_signal_performance()'::regprocedure);
 d=replace(d,'values(new.id,new.id,new.published_at,','values(new.id,new.id,coalesce(new.entry_activated_at,new.published_at),');
 d=replace(d,'if new.published_at is null then','if new.entry_phase in (''waiting'',''cancelled'') or new.published_at is null then');
 execute d;
 d=pg_get_functiondef('public.get_member_signal_summary()'::regprocedure);
 d=replace(d,'published_at>=b.session_start and published_at<b.session_reset','coalesce(entry_activated_at,published_at)>=b.session_start and coalesce(entry_activated_at,published_at)<b.session_reset');
 d=replace(d,'status in (''active'',''closed'')','status in (''active'',''closed'') and (entry_phase is null or entry_phase=''entered'')');
 execute d;
 d=pg_get_functiondef('public.notification_allowed_before_client_gate(uuid,uuid)'::regprocedure);
 d=replace(d,'''signal.active'',''signal.modified'',''signal.closed''','''signal.active'',''signal.modified'',''signal.closed'',''signal.waiting'',''signal.waiting_cancelled''');
 execute d;
end;$$;
create function public.base_wait_expiry(event_time bigint,frame text) returns bigint language sql immutable strict security invoker set search_path='' as $$
 select case when frame='MN1' then extract(epoch from ((to_timestamp(event_time) at time zone 'UTC'+interval '13 months') at time zone 'UTC'))::bigint else event_time+13*case frame when 'M15' then 900 when 'M30' then 1800 when 'H1' then 3600 when 'H4' then 14400 when 'W1' then 604800 end end;
$$;
create function public.base_wait_context(snapshot jsonb,frame text,buy boolean) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare htf text;bars jsonb;pivots jsonb;highs numeric[];lows numeric[];n int;k int;sign int=case when buy then 1 else -1 end;
begin
 htf=case frame when 'M15' then 'M30' when 'M30' then 'H1' when 'H1' then 'H4' when 'H4' then 'W1' when 'W1' then 'MN1' end;
 if htf is null then return frame='MN1';end if;
 select s->'candles' into bars from jsonb_array_elements(snapshot->'series')s where s->>'timeframe'=htf;
 if jsonb_array_length(bars)<10 then return false;end if;
 pivots=public.hns_pivots(bars,jsonb_array_length(bars)-1,false);
 select array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='high'),array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='low') into highs,lows from jsonb_array_elements(pivots) with ordinality q(p,ordinality);
 n=coalesce(array_length(highs,1),0);k=coalesce(array_length(lows,1),0);
 return coalesce(n>=2 and k>=2 and sign*(highs[n]-highs[n-1])>0 and sign*(lows[k]-lows[k-1])>0,false);
end;$$;
revoke all on function public.base_wait_expiry(bigint,text),public.base_wait_context(jsonb,text,boolean) from public,anon,authenticated,service_role;
alter function public.apply_automatic_engine(timestamptz,jsonb) rename to apply_automatic_engine_before_waiting;
do $$declare d text;begin
 d=pg_get_functiondef('public.apply_automatic_engine_before_waiting(timestamptz,jsonb)'::regprocedure);
 d=replace(d,'a.action=''engine.signal_published''','a.action in (''engine.signal_published'',''engine.waiting_published'')');execute d;
end;$$;
revoke all on function public.apply_automatic_engine_before_waiting(timestamptz,jsonb) from public,anon,authenticated,service_role;
create function public.apply_automatic_engine(export_time timestamptz,plans jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.mt5_bridge_latest;p public.automatic_engine_policy;r jsonb;active_plans jsonb;plan jsonb;item record;buy boolean;quote_price numeric;exit_price numeric;stamp bigint;new_id uuid;why text;targets numeric[];waiting integer=0;activated integer=0;cancelled integer=0;expires bigint;last_m5 bigint;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if jsonb_typeof(plans) is distinct from 'array' or jsonb_array_length(plans)>24 then raise exception 'Invalid plan batch';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('panther-auto-engine'));
 select coalesce(jsonb_agg(v),'[]') into active_plans from jsonb_array_elements(plans)v where coalesce(v->>'entryState','active')<>'waiting';
 r=public.apply_automatic_engine_before_waiting(export_time,active_plans);
 if coalesce((r->>'processed')::boolean,false) is not true then return r;end if;
 select * into f from public.mt5_bridge_latest where source='vestrado' for share;
 select * into p from public.automatic_engine_policy where singleton for share;
 -- Pending setups are never monitored as trades. Pausing publication cancels them safely.
 for item in select w.*,s.direction,s.entry_low,s.entry_high,s.stop_loss,s.tp1,s.tp2,s.tp3,s.timeframe from public.automatic_entry_waits w join public.signals s on s.id=w.signal_id where s.status='pending' and s.entry_phase='waiting' for update of w,s loop
  if export_time<=item.last_snapshot then continue;end if;
  buy=item.direction='BUY';why=null;
  quote_price=case when buy then (f.snapshot->'quote'->>'ask')::numeric else (f.snapshot->'quote'->>'bid')::numeric end;
  exit_price=case when buy then (f.snapshot->'quote'->>'bid')::numeric else (f.snapshot->'quote'->>'ask')::numeric end;
  if not p.enabled or p.base_entry_mode is distinct from 'base-waiting-v1' then why='policy_paused';
  elsif export_time-item.last_snapshot>interval '90 seconds' then why='monitoring_gap';
  elsif (f.snapshot->>'server_time_raw')::bigint>=item.expires_broker then why='setup_expired';
  elsif not public.base_wait_context(f.snapshot,item.timeframe,buy) then why='higher_context_changed';
  elsif exists(select 1 from jsonb_array_elements(case when buy then (select s->'candles' from jsonb_array_elements(f.snapshot->'series')s where s->>'timeframe'='M5') else coalesce(f.snapshot->'ask_m5','[]') end)c where (c->>'opened_at_server_raw')::bigint>(item.plan->>'confirmationOpenedServer')::bigint and case when buy then (c->>'close')::numeric<=item.stop_loss else (c->>'close')::numeric>=item.stop_loss end) then why='base_invalidated';
  elsif exists(select 1 from jsonb_array_elements(coalesce(f.snapshot->'quote_ticks','[]')||jsonb_build_array(f.snapshot->'quote'))q where (q->>'last_tick_time_msc_raw')::bigint>item.last_tick_msc and case when buy then (q->>'bid')::numeric>=item.tp1 else (q->>'ask')::numeric<=item.tp1 end) then why='target_reached_before_entry';end if;
  -- Targets must still be the same intact structure; never replace a published target silently.
  select array_agg(price order by case when buy then price else -price end) into targets from (select price from public.tick_volume_roadblocks(f.snapshot,(f.snapshot->>'server_time_raw')::bigint) where timeframe in ('M30','H1','H4') and kind=case when buy then 'resistance' else 'support' end and case when buy then price>item.entry_high else price<item.entry_low end group by price order by case when buy then price else -price end limit 3)x;
  if why is null and targets is distinct from array[(item.plan->'targets'->>0)::numeric,(item.plan->'targets'->>1)::numeric,(item.plan->'targets'->>2)::numeric] then why='target_structure_changed';end if;
  if why is not null then
   update public.signals set status='closed',entry_phase='cancelled',entry_wait_reason=why,closed_at=now() where id=item.signal_id;
   delete from public.automatic_entry_waits where signal_id=item.signal_id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(item.signal_id::text||':waiting-cancelled',item.signal_id,'signal.waiting_cancelled','public',jsonb_build_object('reason',why,'no_entry',true)) on conflict do nothing;
   insert into public.audit_logs(action,entity_id,details) values('engine.waiting_cancelled',item.signal_id,jsonb_build_object('reason',why,'no_entry',true));cancelled=cancelled+1;continue;
  end if;
  if quote_price between item.entry_low and item.entry_high then
   -- SELL activation also requires a fresh, actual ask-side completed M5 stream.
   select max((c->>'opened_at_server_raw')::bigint) into last_m5 from jsonb_array_elements(case when buy then (select s->'candles' from jsonb_array_elements(f.snapshot->'series')s where s->>'timeframe'='M5') else coalesce(f.snapshot->'ask_m5','[]') end)c;
   if last_m5 is not null and (f.snapshot->>'server_time_raw')::bigint-(last_m5+300) between 0 and 300 then
    update public.signals set status='active',entry_phase='entered',entry_activated_at=now(),entry=quote_price,entry_wait_reason=null,pricing_source='Vestrado MT5: observed zone entry, no broker fill' where id=item.signal_id;
    insert into public.automatic_engine_tracking(signal_id,last_snapshot,last_m5_open,last_tick_msc) values(item.signal_id,export_time,last_m5,(f.snapshot->'quote'->>'last_tick_time_msc_raw')::bigint);
    delete from public.automatic_entry_waits where signal_id=item.signal_id;
    insert into public.notification_outbox(event_key,signal_id,event_type,access) values(item.signal_id::text||':active',item.signal_id,'signal.active','public') on conflict do nothing;
    insert into public.audit_logs(action,entity_id,details) values('engine.waiting_activated',item.signal_id,jsonb_build_object('observed_entry',quote_price,'execution','hypothetical'));activated=activated+1;continue;
   end if;
  end if;
  update public.automatic_entry_waits set last_snapshot=export_time,last_tick_msc=(f.snapshot->'quote'->>'last_tick_time_msc_raw')::bigint where signal_id=item.signal_id;
 end loop;
 if p.enabled and p.base_entry_mode='base-waiting-v1' and exists(select 1 from public.profiles where id=p.approved_by and role='admin') then
  for plan in select v from jsonb_array_elements(plans)v where v->>'entryState'='waiting' loop
   if plan->>'version' is distinct from p.version or plan->>'provider' is distinct from 'Vestrado MT5' or plan->>'sourceEventId' !~ '^[a-f0-9]{64}$' or plan->>'method' not in ('BOS','CHOCH') or not public.valid_base_retest_plan(f.snapshot,plan) then raise exception 'Invalid waiting setup evidence';end if;
   if exists(select 1 from public.signals where source='mt5' and source_event_id=plan->>'sourceEventId') or exists(select 1 from public.retired_signal_keys where source='mt5' and source_event_id=plan->>'sourceEventId') then continue;end if;
   if exists(select 1 from public.signals s join public.audit_logs a on a.entity_id=s.id and a.action in ('engine.signal_published','engine.waiting_published') where s.source='mt5' and s.strategy in ('SBR','RBS') and s.timeframe=plan->>'timeframe' and s.direction=plan->>'direction' and ((a.details->>'breakout_broker_time')::bigint=(plan->>'breakoutOpenedServer')::bigint or (a.details->>'confirmation_broker_time')::bigint=(plan->>'confirmationOpenedServer')::bigint)) then continue;end if;
   buy=plan->>'direction'='BUY';stamp=(plan->>'confirmationOpenedServer')::bigint;
   quote_price=case when buy then (f.snapshot->'quote'->>'ask')::numeric else (f.snapshot->'quote'->>'bid')::numeric end;
   exit_price=case when buy then (f.snapshot->'quote'->>'bid')::numeric else (f.snapshot->'quote'->>'ask')::numeric end;
   if exists(select 1 from unnest(array[(plan->>'entry')::numeric,(plan->>'zoneLow')::numeric,(plan->>'zoneHigh')::numeric,(plan->>'stop')::numeric,(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric]) n where n is null or n<=0 or n::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid waiting prices';end if;
   if (plan->>'zoneHigh')::numeric-(plan->>'zoneLow')::numeric not between 0 and 8 or (plan->>'entry')::numeric is distinct from (case when buy then (plan->>'zoneHigh')::numeric else (plan->>'zoneLow')::numeric end) or jsonb_array_length(plan->'targets')<>3 or length(plan->>'reason') not between 20 and 2000 then raise exception 'Invalid waiting zone';end if;
   if (buy and (quote_price<=(plan->>'zoneHigh')::numeric or exit_price>=(plan->'targets'->>0)::numeric)) or (not buy and (quote_price>=(plan->>'zoneLow')::numeric or exit_price<=(plan->'targets'->>0)::numeric)) then continue;end if;
   if not buy and not exists(select 1 from jsonb_array_elements(coalesce(f.snapshot->'ask_m5','[]'))c where (c->>'opened_at_server_raw')::bigint=stamp) then raise exception 'Waiting SELL requires ask M5 evidence';end if;
   select array_agg(price order by case when buy then price else -price end) into targets from (select price from public.tick_volume_roadblocks(f.snapshot,stamp+300) where timeframe in ('M30','H1','H4') and kind=case when buy then 'resistance' else 'support' end and case when buy then price>(plan->>'zoneHigh')::numeric else price<(plan->>'zoneLow')::numeric end group by price order by case when buy then price else -price end limit 3)x;
   if targets is distinct from array[(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric] then raise exception 'Waiting targets mismatch';end if;
   expires=public.base_wait_expiry((plan->>'breakoutOpenedServer')::bigint,plan->>'timeframe');
   if expires is null or expires<=(f.snapshot->>'server_time_raw')::bigint then continue;end if;
   insert into public.signals(instrument,direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,higher_timeframe,engine_version)
   values('XAUUSD',plan->>'direction',(plan->>'entry')::numeric,(plan->>'zoneLow')::numeric,(plan->>'zoneHigh')::numeric,(plan->>'stop')::numeric,(plan->'targets'->>0)::numeric,(plan->'targets'->>1)::numeric,(plan->'targets'->>2)::numeric,'WAITING FOR ENTRY. '||left(plan->>'reason',1900),'public','mt5',plan->>'sourceEventId',plan->>'sourceEventId',f.exported_at,null,plan->>'method',plan->>'timeframe',plan->>'higherTimeframe',p.version) returning id into new_id;
   update public.signals set status='pending',entry_phase='waiting',approved_by=p.approved_by,published_at=now(),pricing_source='Confirmed setup; waiting for observed zone entry, no broker fill' where id=new_id;
   insert into public.automatic_entry_waits(signal_id,plan,expires_broker,last_snapshot,last_tick_msc) values(new_id,plan,expires,export_time,(f.snapshot->'quote'->>'last_tick_time_msc_raw')::bigint);
   insert into public.notification_outbox(event_key,signal_id,event_type,access) values(new_id::text||':waiting',new_id,'signal.waiting','public');
   insert into public.audit_logs(actor_id,action,entity_id,details) values(p.approved_by,'engine.waiting_published',new_id,jsonb_build_object('policy_version','base-waiting-v1','breakout_broker_time',plan->'breakoutOpenedServer','confirmation_broker_time',stamp,'expires_broker',expires,'base',plan->'base','execution','hypothetical'));waiting=waiting+1;
  end loop;
 end if;
 r=r||jsonb_build_object('waiting',waiting,'activated',activated,'cancelled',cancelled);
 update public.automatic_engine_policy set last_result=r where singleton;
 return r;
end;$$;
revoke all on function public.apply_automatic_engine(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_automatic_engine(timestamptz,jsonb) to service_role;
-- Entry phase and locked base metadata are service-owned, including pending rows.
create function public.guard_waiting_entry_fields() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if auth.role() is distinct from 'service_role' and (new.entry_phase is not null or new.entry_activated_at is not null or new.entry_wait_reason is not null) then raise exception 'Automatic entry metadata is engine-owned';end if;return new;
 end if;
 if auth.role() is distinct from 'service_role' and (new.entry_phase is distinct from old.entry_phase or new.entry_activated_at is distinct from old.entry_activated_at or new.entry_wait_reason is distinct from old.entry_wait_reason or old.entry_phase='waiting') then raise exception 'Automatic waiting setup is engine-owned';end if;return new;
end;$$;
create trigger guard_waiting_entry_fields before insert or update on public.signals for each row execute function public.guard_waiting_entry_fields();
revoke all on function public.guard_waiting_entry_fields() from public,anon,authenticated,service_role;
commit;
