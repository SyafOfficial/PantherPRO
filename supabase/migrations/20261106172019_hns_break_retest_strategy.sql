begin;
-- Deterministic confirmed swings. Normalized HNS pivots discard ambiguous outside
-- bars and retain only the more extreme of successive same-side pivots.
create function public.hns_pivots(bars jsonb,before_index integer,normalize_pivots boolean default true)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb='[]';i integer;j integer;n integer;hi boolean;lo boolean;v jsonb;last jsonb;kind text;
begin
 if jsonb_typeof(bars)<>'array' or jsonb_array_length(bars)>1000 then return result;end if;
 for i in 2..least(before_index-3,jsonb_array_length(bars)-3) loop
  hi=true;lo=true;v=bars->i;
  for j in -2..2 loop
   if j<>0 then
    hi=hi and (v->>'high')::numeric>((bars->(i+j))->>'high')::numeric;
    lo=lo and (v->>'low')::numeric<((bars->(i+j))->>'low')::numeric;
   end if;
  end loop;
  if normalize_pivots and hi and lo then continue;end if;
  foreach kind in array array['high','low'] loop
   if (kind='high' and not hi) or (kind='low' and not lo) then continue;end if;
   n=jsonb_array_length(result);last=result->(n-1);
   v=jsonb_build_object('kind',kind,'index',i,'price',(bars->i->>kind)::numeric,'at',(bars->i->>'opened_at_server_raw')::bigint);
   if normalize_pivots and n>0 and last->>'kind'=kind then
    if (kind='high' and (v->>'price')::numeric>(last->>'price')::numeric) or (kind='low' and (v->>'price')::numeric<(last->>'price')::numeric) then result=jsonb_set(result,array[(n-1)::text],v);end if;
   else result=result||jsonb_build_array(v);end if;
  end loop;
 end loop;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then return '[]'::jsonb;
end;$$;
revoke all on function public.hns_pivots(jsonb,integer,boolean) from public,anon,authenticated,service_role;

create function public.valid_hns_plan(snapshot jsonb,plan jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare evidence jsonb=plan->'hns';bars jsonb;context jsonb;pivots jsonb;c jsonb;previous jsonb;pivot_bar jsonb;
 frame text=plan->>'timeframe';htf text;frame_seconds bigint;htf_seconds bigint;event_time bigint;confirm_time bigint;event_index integer;
 times bigint[]='{}';prices numeric[]='{}';indices integer[]='{}';i integer;j integer;k integer;n integer;matched boolean=false;buy boolean;sign numeric;canonical numeric;
 neck numeric;slope numeric;height numeric;prominence numeric;ratio numeric;point_size numeric;tol numeric;range_size numeric;level numeric;highs numeric[];lows numeric[];
begin
 if plan->>'method' is distinct from 'HNS' or evidence->>'version' is distinct from 'hns-v1' or frame not in ('M15','M30','H1','H4') or jsonb_typeof(evidence->'anchors') is distinct from 'array' or jsonb_array_length(evidence->'anchors')<>5 or plan->>'direction' not in ('BUY','SELL') then return false;end if;
 buy=plan->>'direction'='BUY';sign=case when buy then 1 else -1 end;canonical=-sign;
 htf=case frame when 'M15' then 'M30' when 'M30' then 'H1' when 'H1' then 'H4' else 'W1' end;
 frame_seconds=case frame when 'M15' then 900 when 'M30' then 1800 when 'H1' then 3600 else 14400 end;
 htf_seconds=case htf when 'M30' then 1800 when 'H1' then 3600 when 'H4' then 14400 else 604800 end;
 if plan->>'higherTimeframe' is distinct from htf then return false;end if;
 event_time=(plan->>'breakoutOpenedServer')::bigint;confirm_time=(plan->>'confirmationOpenedServer')::bigint;
 point_size=(snapshot->>'point')::numeric;tol=point_size*2;
 if event_time is null or confirm_time is null or point_size is null or point_size<=0 or event_time+frame_seconds>confirm_time or (snapshot->>'server_time_raw')::bigint-(confirm_time+300) not between 0 and 300 then return false;end if;
 select coalesce(jsonb_agg(b order by (b->>'opened_at_server_raw')::bigint),'[]') into bars from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'=frame and (b->>'opened_at_server_raw')::bigint+frame_seconds<=confirm_time;
 select ordinality::integer-1 into event_index from jsonb_array_elements(bars) with ordinality b where (value->>'opened_at_server_raw')::bigint=event_time;
 if event_index is null or event_index<14 or event_index<jsonb_array_length(bars)-12 then return false;end if;
 pivots=public.hns_pivots(bars,event_index,true);n=jsonb_array_length(pivots);
 if n<5 then return false;end if;
 for i in greatest(0,n-48)..n-5 loop
  matched=true;
  for j in 0..4 loop
   if (pivots->(i+j)->>'at')::bigint is distinct from (evidence->'anchors'->>j)::bigint then matched=false;exit;end if;
  end loop;
  if matched then
   for j in 0..4 loop
    pivot_bar=pivots->(i+j);
    if pivot_bar->>'kind' is distinct from (case when j%2=0 then case when buy then 'low' else 'high' end else case when buy then 'high' else 'low' end end) then return false;end if;
    times=array_append(times,(pivot_bar->>'at')::bigint);prices=array_append(prices,(pivot_bar->>'price')::numeric);indices=array_append(indices,(pivot_bar->>'index')::integer);
   end loop;exit;
  end if;
 end loop;
 if not matched or indices[1]<5 or indices[5]-indices[1]>120 then return false;end if;
 for j in 2..5 loop if indices[j]-indices[j-1]<3 then return false;end if;end loop;
 slope=(prices[4]-prices[2])/(times[4]-times[2]);
 height=canonical*(prices[3]-(prices[2]+slope*(times[3]-times[2])));
 prominence=canonical*prices[3]-greatest(canonical*prices[1],canonical*prices[5]);
 ratio=(indices[3]-indices[1])::numeric/(indices[5]-indices[3]);
 if height<=point_size*4 or prominence<height*0.1 or abs(prices[1]-prices[5])>height*0.35 or abs(prices[2]-prices[4])>height*0.5 or ratio<0.4 or ratio>2.5 then return false;end if;
 foreach j in array array[1,5] loop if canonical*(prices[j]-(prices[2]+slope*(times[j]-times[2])))<height*0.2 then return false;end if;end loop;
 if canonical*(prices[1]-(bars->greatest(0,indices[1]-12)->>'close')::numeric)<height*0.5 then return false;end if;
 if canonical*((bars->(event_index-1)->>'close')::numeric-(prices[2]+slope*((bars->(event_index-1)->>'opened_at_server_raw')::bigint-times[2])))<0 or canonical*((bars->event_index->>'close')::numeric-(prices[2]+slope*(event_time-times[2])))>=-tol then return false;end if;
 for j in indices[5]+1..event_index-1 loop if canonical*((bars->j->>'close')::numeric-(prices[2]+slope*((bars->j->>'opened_at_server_raw')::bigint-times[2])))<-tol then return false;end if;end loop;
 for j in event_index+1..jsonb_array_length(bars)-1 loop if sign*((bars->j->>'close')::numeric-(prices[2]+slope*((bars->j->>'opened_at_server_raw')::bigint+frame_seconds-times[2])))<-tol then return false;end if;end loop;
 select b into c from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time;
 select b into previous from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time-300;
 if c is null or previous is null or (c->>'low')::numeric is distinct from (plan->>'zoneLow')::numeric or (c->>'high')::numeric is distinct from (plan->>'zoneHigh')::numeric then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>confirm_time and (b->>'opened_at_server_raw')::bigint+300<=(snapshot->>'server_time_raw')::bigint) then return false;end if;
 level=prices[2]+slope*(confirm_time-times[2]);range_size=(c->>'high')::numeric-(c->>'low')::numeric;
 if range_size<=0 or (c->>'low')::numeric>level or (c->>'high')::numeric<level or sign*((c->>'close')::numeric-(c->>'open')::numeric)<range_size*0.25 or (case when buy then (c->>'close')::numeric-(c->>'low')::numeric else (c->>'high')::numeric-(c->>'close')::numeric end)/range_size<0.65 or sign*((c->>'close')::numeric-(prices[2]+slope*(confirm_time+300-times[2])))<=tol or (buy and (c->>'close')::numeric<=(previous->>'high')::numeric) or (not buy and (c->>'close')::numeric>=(previous->>'low')::numeric) then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>=event_time+frame_seconds and (b->>'opened_at_server_raw')::bigint<confirm_time and sign*((b->>'close')::numeric-(prices[2]+slope*((b->>'opened_at_server_raw')::bigint+300-times[2])))<-tol) then return false;end if;
 if abs((plan->>'stop')::numeric-(case when buy then (c->>'low')::numeric-3 else (c->>'high')::numeric+3 end))>0.000001 then return false;end if;
 select coalesce(jsonb_agg(b order by (b->>'opened_at_server_raw')::bigint),'[]') into context from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'=htf and (b->>'opened_at_server_raw')::bigint+htf_seconds<=confirm_time+300;
 if jsonb_array_length(context)<10 then return false;end if;
 pivots=public.hns_pivots(context,jsonb_array_length(context)-1,false);
 select array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='high'),array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='low') into highs,lows from jsonb_array_elements(pivots) with ordinality q(p,ordinality);
 if coalesce(array_length(highs,1),0)<2 or coalesce(array_length(lows,1),0)<2 then return false;end if;
 n=array_length(highs,1);k=array_length(lows,1);
 return sign*(highs[n]-highs[n-1])>0 and sign*(lows[k]-lows[k-1])>0;
exception when invalid_text_representation or numeric_value_out_of_range or division_by_zero or array_subscript_error then return false;
end;$$;
revoke all on function public.valid_hns_plan(jsonb,jsonb) from public,anon,authenticated,service_role;

alter table public.signals drop constraint signals_strategy_check;
alter table public.signals add constraint signals_strategy_check check(strategy in ('QM','QMTR','BOS','CHOCH','TRENDLINE','TICK_VOLUME','HNS'));
alter table public.signals add constraint signals_hns_timeframe_check check(strategy is distinct from 'HNS' or timeframe in ('M15','M30','H1','H4'));
-- Patch only the publication validation branch. Quote/SL/BE/TP monitoring is retained verbatim.
do $$ declare definition text;updated text;
begin
 definition=pg_get_functiondef('public.apply_automatic_engine(timestamptz,jsonb)'::regprocedure);
 if position('plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'')' in definition)=0 or position('if plan ? ''trendline'' then' in definition)=0 then raise exception 'Unexpected engine definition; HNS migration requires review';end if;
 updated=replace(definition,'plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'')','plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'')');
 updated=replace(updated,'if plan ? ''trendline'' then','if plan->>''method''=''HNS'' then if not public.valid_hns_plan(feed.snapshot,plan) then raise exception ''HNS break/retest evidence invalid'';end if; elsif plan ? ''trendline'' then');
 updated=replace(updated,'''trendline'',plan->''trendline''','''hns'',plan->''hns'',''trendline'',plan->''trendline''');
 execute updated;
end;$$;
commit;
