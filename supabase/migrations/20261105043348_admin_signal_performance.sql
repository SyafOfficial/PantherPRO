begin;
create table public.signal_performance_ledger (
 id uuid primary key,
 source_signal_id uuid unique references public.signals(id) on delete set null,
 published_at timestamptz not null,
 closed_at timestamptz,
 strategy text,
 timeframe text,
 higher_timeframe text,
 direction text not null check(direction in ('BUY','SELL')),
 entry numeric not null,
 stop_loss numeric not null,
 tp1 numeric not null,
 tp2 numeric not null,
 tp3 numeric not null,
 status text not null,
 tp1_hit_at timestamptz,
 tp2_hit_at timestamptz,
 tp3_hit_at timestamptz,
 sl_hit_at timestamptz,
 be_alert boolean not null default false,
 be_alert_at timestamptz,
 be_exit_at timestamptz,
 monitoring_gap boolean not null default false,
 updated_at timestamptz not null default now()
);
create index performance_ledger_published on public.signal_performance_ledger(published_at desc);
alter table public.signal_performance_ledger enable row level security;
revoke all on public.signal_performance_ledger from public,anon,authenticated,service_role;
grant select on public.signal_performance_ledger to authenticated;
create policy performance_admin_read on public.signal_performance_ledger for select to authenticated
 using(public.is_admin() and auth.jwt()->>'aal'='aal2');

create function public.capture_signal_performance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.published_at is null then return new;end if;
 if tg_op='UPDATE' and row(new.published_at,new.closed_at,new.strategy,new.timeframe,new.higher_timeframe,new.direction,new.entry,new.stop_loss,new.tp1,new.tp2,new.tp3,new.status,new.tp1_hit_at,new.tp2_hit_at,new.tp3_hit_at,new.stop_observed_at,new.break_even,new.reconciliation_state)
 is not distinct from row(old.published_at,old.closed_at,old.strategy,old.timeframe,old.higher_timeframe,old.direction,old.entry,old.stop_loss,old.tp1,old.tp2,old.tp3,old.status,old.tp1_hit_at,old.tp2_hit_at,old.tp3_hit_at,old.stop_observed_at,old.break_even,old.reconciliation_state) then return new;end if;
 insert into public.signal_performance_ledger(id,source_signal_id,published_at,closed_at,strategy,timeframe,higher_timeframe,direction,entry,stop_loss,tp1,tp2,tp3,status,tp1_hit_at,tp2_hit_at,tp3_hit_at,sl_hit_at,be_alert,monitoring_gap)
 values(new.id,new.id,new.published_at,new.closed_at,new.strategy,new.timeframe,new.higher_timeframe,new.direction,new.entry,new.stop_loss,new.tp1,new.tp2,new.tp3,new.status::text,new.tp1_hit_at,new.tp2_hit_at,new.tp3_hit_at,new.stop_observed_at,new.break_even,new.reconciliation_state='gap')
 on conflict(id) do update set closed_at=excluded.closed_at,strategy=excluded.strategy,timeframe=excluded.timeframe,higher_timeframe=excluded.higher_timeframe,
 stop_loss=case when signal_performance_ledger.sl_hit_at is not null then signal_performance_ledger.stop_loss else excluded.stop_loss end,
 tp1=case when signal_performance_ledger.tp1_hit_at is not null then signal_performance_ledger.tp1 else excluded.tp1 end,
 tp2=case when signal_performance_ledger.tp2_hit_at is not null then signal_performance_ledger.tp2 else excluded.tp2 end,
 tp3=case when signal_performance_ledger.tp3_hit_at is not null then signal_performance_ledger.tp3 else excluded.tp3 end,
 status=excluded.status,tp1_hit_at=coalesce(signal_performance_ledger.tp1_hit_at,excluded.tp1_hit_at),tp2_hit_at=coalesce(signal_performance_ledger.tp2_hit_at,excluded.tp2_hit_at),tp3_hit_at=coalesce(signal_performance_ledger.tp3_hit_at,excluded.tp3_hit_at),sl_hit_at=coalesce(signal_performance_ledger.sl_hit_at,excluded.sl_hit_at),
 be_alert=signal_performance_ledger.be_alert or excluded.be_alert,monitoring_gap=signal_performance_ledger.monitoring_gap or excluded.monitoring_gap,updated_at=now();
 return new;
end;$$;
revoke all on function public.capture_signal_performance() from public,anon,authenticated,service_role;
create trigger signal_performance_capture after insert or update of published_at,closed_at,strategy,timeframe,higher_timeframe,direction,entry,stop_loss,tp1,tp2,tp3,status,tp1_hit_at,tp2_hit_at,tp3_hit_at,stop_observed_at,break_even,reconciliation_state on public.signals for each row execute function public.capture_signal_performance();

create function public.capture_performance_alert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.signal_id is not null and new.event_type in ('signal.break_even','signal.be_hit') then
  update public.signal_performance_ledger set
   be_alert=be_alert or new.event_type='signal.break_even',
   be_alert_at=case when new.event_type='signal.break_even' then coalesce(be_alert_at,new.created_at) else be_alert_at end,
   be_exit_at=case when new.event_type='signal.be_hit' then coalesce(be_exit_at,new.created_at) else be_exit_at end,
   updated_at=now()
  where id=new.signal_id;
 end if;
 return new;
end;$$;
revoke all on function public.capture_performance_alert() from public,anon,authenticated,service_role;
create trigger performance_alert_capture after insert on public.notification_outbox for each row execute function public.capture_performance_alert();

insert into public.signal_performance_ledger(id,source_signal_id,published_at,closed_at,strategy,timeframe,higher_timeframe,direction,entry,stop_loss,tp1,tp2,tp3,status,tp1_hit_at,tp2_hit_at,tp3_hit_at,sl_hit_at,be_alert,monitoring_gap)
 select id,id,published_at,closed_at,strategy,timeframe,higher_timeframe,direction,entry,stop_loss,tp1,tp2,tp3,status::text,tp1_hit_at,tp2_hit_at,tp3_hit_at,stop_observed_at,break_even,reconciliation_state='gap'
 from public.signals where published_at is not null;
update public.signal_performance_ledger p set be_alert_at=e.alert_at,be_exit_at=e.exit_at,be_alert=p.be_alert or e.alert_at is not null
 from (select signal_id,min(created_at) filter(where event_type='signal.break_even') alert_at,min(created_at) filter(where event_type='signal.be_hit') exit_at from public.notification_outbox where signal_id is not null and event_type in ('signal.break_even','signal.be_hit') group by signal_id) e where p.id=e.signal_id;

create function public.signal_session_bounds(at_time timestamptz) returns table(session_start timestamptz,session_reset timestamptz,in_break boolean)
 language sql stable security invoker set search_path='' as $$
 with local as (select at_time at time zone 'Asia/Kuala_Lumpur' t),
 bounds as (select date_trunc('day',t)+interval '6 hours'-case when t::time<time '05:30' then interval '1 day' else interval '0 days' end as start_local,t::time>=time '05:30' and t::time<time '06:00' as gap from local)
 select start_local at time zone 'Asia/Kuala_Lumpur',(start_local+interval '23 hours 30 minutes') at time zone 'Asia/Kuala_Lumpur',gap from bounds;
$$;
revoke all on function public.signal_session_bounds(timestamptz) from public,anon,authenticated,service_role;
create function public.get_member_signal_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b record;current_time_utc timestamptz=now();
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select * into b from public.signal_session_bounds(current_time_utc);
 return jsonb_build_object('count',case when b.in_break then 0 else (select count(*) from public.signals where published_at>=b.session_start and published_at<b.session_reset and status in ('active','closed')) end,
 'active_count',(select count(*) from public.signals where status='active' and published_at is not null),'session_start',b.session_start,'session_reset',b.session_reset,'as_of',current_time_utc);
end;$$;
revoke all on function public.get_member_signal_summary() from public,anon;
grant execute on function public.get_member_signal_summary() to authenticated;

create function public.signal_performance_metrics(p public.signal_performance_ledger)
 returns table(outcome text,highest_tp integer,tp_pips numeric,sl_pips numeric,running_pips numeric,total_pips numeric)
 language plpgsql immutable security invoker set search_path='' as $$
declare sign numeric=case when p.direction='BUY' then 1 else -1 end;
begin
 highest_tp=case when p.tp3_hit_at is not null then 3 when p.tp2_hit_at is not null then 2 when p.tp1_hit_at is not null then 1 else 0 end;
 tp_pips=0;sl_pips=0;running_pips=0;
 if highest_tp>0 then outcome='Win';tp_pips=round(greatest(0,sign*((case highest_tp when 3 then p.tp3 when 2 then p.tp2 else p.tp1 end)-p.entry)/0.1),1);
 elsif p.sl_hit_at is not null then outcome='Loss';sl_pips=round(abs(p.entry-p.stop_loss)/0.1,1);
 elsif p.be_exit_at is not null then outcome='BE';
 elsif p.status='active' and p.be_alert then outcome='Running +50';running_pips=50;
 elsif p.status='active' then outcome='Active';
 else outcome='Unclassified';end if;
 total_pips=tp_pips-sl_pips+running_pips;
 return next;
end;$$;
revoke all on function public.signal_performance_metrics(public.signal_performance_ledger) from public,anon,authenticated,service_role;

create function public.get_admin_signal_performance(from_time timestamptz,to_time timestamptz,strategy_filter text default null,timeframe_filter text default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() or auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA administrator required';end if;
 if from_time is null or to_time is null or to_time<=from_time or to_time-from_time>interval '366 days' then raise exception 'Choose a date range up to 366 days';end if;
 with rows as materialized (
  select p.*,m.outcome,m.highest_tp,m.tp_pips,m.sl_pips,m.running_pips,m.total_pips
  from public.signal_performance_ledger p cross join lateral public.signal_performance_metrics(p) m
  where p.published_at>=from_time and p.published_at<to_time and (strategy_filter is null or p.strategy=strategy_filter) and (timeframe_filter is null or p.timeframe=timeframe_filter)
 ), summary as (
  select count(*) signals,count(*) filter(where status='active') active,count(*) filter(where status='closed') closed,
   count(*) filter(where outcome='Win') wins,count(*) filter(where outcome='Loss') losses,count(*) filter(where outcome='BE') be,
   count(*) filter(where outcome='Unclassified') unclassified,count(*) filter(where outcome='Running +50') running_50,
   count(*) filter(where tp1_hit_at is not null) tp1_hits,count(*) filter(where tp2_hit_at is not null) tp2_hits,count(*) filter(where tp3_hit_at is not null) tp3_hits,
   count(*) filter(where sl_hit_at is not null) sl_hits,count(*) filter(where be_alert) be_alerts,
   coalesce(sum(tp_pips),0) tp_pips,coalesce(sum(sl_pips),0) sl_pips,coalesce(sum(running_pips),0) running_pips,coalesce(sum(total_pips),0) total_pips,
   round(100.0*count(*) filter(where outcome='Win')/nullif(count(*) filter(where outcome in ('Win','Loss')),0),1) win_rate
  from rows
 ), setups as (
  select coalesce(strategy,'Unclassified') strategy,coalesce(timeframe,'—') timeframe,coalesce(higher_timeframe,'—') higher_timeframe,count(*) signals,
   count(*) filter(where outcome='Win') wins,count(*) filter(where outcome='Loss') losses,count(*) filter(where outcome='BE') be,
   count(*) filter(where outcome='Running +50') running_50,count(*) filter(where tp1_hit_at is not null) tp1_hits,count(*) filter(where tp2_hit_at is not null) tp2_hits,count(*) filter(where tp3_hit_at is not null) tp3_hits,count(*) filter(where sl_hit_at is not null) sl_hits,
   sum(tp_pips) tp_pips,sum(sl_pips) sl_pips,sum(running_pips) running_pips,sum(total_pips) total_pips,
   round(100.0*count(*) filter(where outcome='Win')/nullif(count(*) filter(where outcome in ('Win','Loss')),0),1) win_rate
  from rows group by strategy,timeframe,higher_timeframe
 )
 select jsonb_build_object('summary',(select to_jsonb(s) from summary s),'by_setup',coalesce((select jsonb_agg(to_jsonb(s) order by signals desc,strategy,timeframe) from setups s),'[]'::jsonb),
 'signals',coalesce((select jsonb_agg(to_jsonb(s) order by published_at desc,id) from (select * from rows order by published_at desc,id limit 200) s),'[]'::jsonb),
 'details_limit',200,'as_of',now()) into result;
 return result;
end;$$;
revoke all on function public.get_admin_signal_performance(timestamptz,timestamptz,text,text) from public,anon;
grant execute on function public.get_admin_signal_performance(timestamptz,timestamptz,text,text) to authenticated;
commit;
