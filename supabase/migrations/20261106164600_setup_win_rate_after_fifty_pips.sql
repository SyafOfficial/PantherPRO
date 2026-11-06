-- Setup success is reached at the recorded 50-pip management alert or any TP.
-- Exit outcome and pip calculations remain separate and unchanged.
create or replace function public.get_admin_signal_performance(from_time timestamptz,to_time timestamptz,strategy_filter text default null,timeframe_filter text default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() or auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA administrator required';end if;
 if from_time is null or to_time is null or to_time<=from_time or to_time-from_time>interval '366 days' then raise exception 'Choose a date range up to 366 days';end if;
 with rows as materialized (
  select p.*,m.outcome,m.highest_tp,m.tp_pips,m.sl_pips,m.running_pips,m.total_pips,(p.be_alert or m.highest_tp>0) as setup_win
  from public.signal_performance_ledger p cross join lateral public.signal_performance_metrics(p) m
  where p.published_at>=from_time and p.published_at<to_time and (strategy_filter is null or p.strategy=strategy_filter) and (timeframe_filter is null or p.timeframe=timeframe_filter)
 ), summary as (
  select count(*) signals,count(*) filter(where status='active') active,count(*) filter(where status='closed') closed,
   count(*) filter(where setup_win) wins,count(*) filter(where not setup_win and outcome='Loss') losses,count(*) filter(where outcome='BE') be,
   count(*) filter(where outcome='Unclassified') unclassified,count(*) filter(where outcome='Running +50') running_50,
   count(*) filter(where tp1_hit_at is not null) tp1_hits,count(*) filter(where tp2_hit_at is not null) tp2_hits,count(*) filter(where tp3_hit_at is not null) tp3_hits,
   count(*) filter(where sl_hit_at is not null) sl_hits,count(*) filter(where be_alert) be_alerts,
   coalesce(sum(tp_pips),0) tp_pips,coalesce(sum(sl_pips),0) sl_pips,coalesce(sum(running_pips),0) running_pips,coalesce(sum(total_pips),0) total_pips,
   round(100.0*count(*) filter(where setup_win)/nullif(count(*) filter(where setup_win or outcome='Loss'),0),1) win_rate
  from rows
 ), setups as (
  select coalesce(strategy,'Unclassified') strategy,coalesce(timeframe,'—') timeframe,coalesce(higher_timeframe,'—') higher_timeframe,count(*) signals,
   count(*) filter(where setup_win) wins,count(*) filter(where not setup_win and outcome='Loss') losses,count(*) filter(where outcome='BE') be,
   count(*) filter(where outcome='Running +50') running_50,count(*) filter(where tp1_hit_at is not null) tp1_hits,count(*) filter(where tp2_hit_at is not null) tp2_hits,count(*) filter(where tp3_hit_at is not null) tp3_hits,count(*) filter(where sl_hit_at is not null) sl_hits,
   sum(tp_pips) tp_pips,sum(sl_pips) sl_pips,sum(running_pips) running_pips,sum(total_pips) total_pips,
   round(100.0*count(*) filter(where setup_win)/nullif(count(*) filter(where setup_win or outcome='Loss'),0),1) win_rate
  from rows group by strategy,timeframe,higher_timeframe
 )
 select jsonb_build_object('summary',(select to_jsonb(s) from summary s),'by_setup',coalesce((select jsonb_agg(to_jsonb(s) order by signals desc,strategy,timeframe) from setups s),'[]'::jsonb),
 'signals',coalesce((select jsonb_agg(to_jsonb(s) order by published_at desc,id) from (select * from rows order by published_at desc,id limit 200) s),'[]'::jsonb),
 'win_rate_basis','50_pips_or_any_tp','details_limit',200,'as_of',now()) into result;
 return result;
end;$$;
revoke all on function public.get_admin_signal_performance(timestamptz,timestamptz,text,text) from public,anon;
grant execute on function public.get_admin_signal_performance(timestamptz,timestamptz,text,text) to authenticated;
