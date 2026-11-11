begin;
create function public.valid_ch_plan(snapshot jsonb,plan jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare evidence jsonb=plan->'ch';bars jsonb;context jsonb;pivots jsonb;c jsonb;previous jsonb;
 frame text=plan->>'timeframe';htf text;frame_seconds bigint;htf_seconds bigint;event_time bigint;confirm_time bigint;event_index integer;
 times bigint[]='{}';prices numeric[]='{}';indices integer[]='{}';i integer;j integer;k integer;n integer;buy boolean;sign numeric;
 slope numeric;depth numeric;handle_depth numeric;point_size numeric;tol numeric;range_size numeric;level numeric;highs numeric[];lows numeric[];width integer;broad integer;
begin
 if plan->>'method' is distinct from 'CH' or evidence->>'version' is distinct from 'ch-v1' or frame not in ('M15','M30','H1','H4') or jsonb_typeof(evidence->'anchors') is distinct from 'array' or jsonb_array_length(evidence->'anchors')<>4 or plan->>'direction' not in ('BUY','SELL') then return false;end if;
 buy=plan->>'direction'='BUY';sign=case when buy then 1 else -1 end;
 htf=case frame when 'M15' then 'M30' when 'M30' then 'H1' when 'H1' then 'H4' else 'W1' end;
 frame_seconds=case frame when 'M15' then 900 when 'M30' then 1800 when 'H1' then 3600 else 14400 end;
 htf_seconds=case htf when 'M30' then 1800 when 'H1' then 3600 when 'H4' then 14400 else 604800 end;
 if plan->>'higherTimeframe' is distinct from htf then return false;end if;
 event_time=(plan->>'breakoutOpenedServer')::bigint;confirm_time=(plan->>'confirmationOpenedServer')::bigint;
 point_size=(snapshot->>'point')::numeric;tol=point_size*2;
 if event_time is null or confirm_time is null or point_size is null or point_size<=0 or event_time+frame_seconds>confirm_time or (snapshot->>'server_time_raw')::bigint-(confirm_time+300) not between 0 and 300 then return false;end if;
 select coalesce(jsonb_agg(b order by (b->>'opened_at_server_raw')::bigint),'[]') into bars from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'=frame and (b->>'opened_at_server_raw')::bigint+frame_seconds<=confirm_time;
 select ordinality::integer-1 into event_index from jsonb_array_elements(bars) with ordinality b where (value->>'opened_at_server_raw')::bigint=event_time;
 if event_index is null or event_index<18 or event_index<jsonb_array_length(bars)-12 then return false;end if;
 pivots=public.hns_pivots(bars,event_index,false);
 for j in 0..3 loop
  select ordinality::integer-1 into k from jsonb_array_elements(bars) with ordinality b where (value->>'opened_at_server_raw')::bigint=(evidence->'anchors'->>j)::bigint;
  if k is null or (j>0 and k<=indices[j]) then return false;end if;
  if (select count(*) from jsonb_array_elements(pivots)p where (p->>'index')::integer=k)<>1 then return false;end if;
  if not exists(select 1 from jsonb_array_elements(pivots)p where (p->>'index')::integer=k and p->>'kind'=case when j%2=0 then case when buy then 'high' else 'low' end else case when buy then 'low' else 'high' end end) then return false;end if;
  indices=array_append(indices,k);times=array_append(times,(bars->k->>'opened_at_server_raw')::bigint);prices=array_append(prices,(bars->k->>(case when (j%2=0)=buy then 'high' else 'low' end))::numeric);
 end loop;
 width=indices[3]-indices[1];
 if width not between 12 and 120 or indices[2]-indices[1]<width*.25 or indices[2]-indices[1]>width*.75 or indices[4]-indices[3]<3 or indices[4]-indices[3]>width*.5 or event_index-indices[3]>width*.5+3 then return false;end if;
 slope=(prices[3]-prices[1])/(times[3]-times[1]);depth=sign*(prices[1]+slope*(times[2]-times[1])-prices[2]);
 handle_depth=sign*(prices[1]+slope*(times[4]-times[1])-prices[4]);
 if depth<=point_size*4 or abs(prices[1]-prices[3])>depth*.2 or handle_depth<depth*.1 or handle_depth>depth*.5 then return false;end if;
 broad=0;
 for i in indices[1]+1..indices[3]-1 loop
  level=(bars->i->>(case when buy then 'low' else 'high' end))::numeric;
  if sign*(level-prices[2])<0 then return false;end if;
  if sign*(level-prices[2])<=depth*.25 then broad=broad+1;end if;
  if sign*((bars->i->>'close')::numeric-(prices[1]+slope*((bars->i->>'opened_at_server_raw')::bigint-times[1])))>tol then return false;end if;
 end loop;
 if broad<greatest(3,ceil(width*.15)) then return false;end if;
 foreach i in array array[indices[1]+floor(width*.25)::integer,indices[1]+floor(width*.75)::integer] loop
  if sign*(prices[1]+slope*((bars->i->>'opened_at_server_raw')::bigint-times[1])-(bars->i->>'close')::numeric)<depth*.6 then return false;end if;
 end loop;
 for i in indices[3]+1..event_index-1 loop
  if sign*(prices[1]+slope*((bars->i->>'opened_at_server_raw')::bigint-times[1])-(bars->i->>(case when buy then 'low' else 'high' end))::numeric)>depth*.5 or sign*((bars->i->>'close')::numeric-(prices[1]+slope*((bars->i->>'opened_at_server_raw')::bigint-times[1])))>tol then return false;end if;
 end loop;
 if sign*((bars->(event_index-1)->>'close')::numeric-(prices[1]+slope*((bars->(event_index-1)->>'opened_at_server_raw')::bigint-times[1])))>0 or sign*((bars->event_index->>'close')::numeric-(prices[1]+slope*(event_time-times[1])))<=tol then return false;end if;
 for j in event_index+1..jsonb_array_length(bars)-1 loop if sign*((bars->j->>'close')::numeric-(prices[1]+slope*((bars->j->>'opened_at_server_raw')::bigint+frame_seconds-times[1])))<-tol then return false;end if;end loop;
 select b into c from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time;
 select b into previous from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time-300;
 if c is null or previous is null or (c->>'low')::numeric is distinct from (plan->>'zoneLow')::numeric or (c->>'high')::numeric is distinct from (plan->>'zoneHigh')::numeric then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>confirm_time and (b->>'opened_at_server_raw')::bigint+300<=(snapshot->>'server_time_raw')::bigint) then return false;end if;
 level=prices[1]+slope*(confirm_time-times[1]);range_size=(c->>'high')::numeric-(c->>'low')::numeric;
 if range_size<=0 or (c->>'low')::numeric>level or (c->>'high')::numeric<level or sign*((c->>'close')::numeric-(c->>'open')::numeric)<range_size*0.25 or (case when buy then (c->>'close')::numeric-(c->>'low')::numeric else (c->>'high')::numeric-(c->>'close')::numeric end)/range_size<0.65 or sign*((c->>'close')::numeric-(prices[1]+slope*(confirm_time+300-times[1])))<=tol or (buy and (c->>'close')::numeric<=(previous->>'high')::numeric) or (not buy and (c->>'close')::numeric>=(previous->>'low')::numeric) then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>=event_time+frame_seconds and (b->>'opened_at_server_raw')::bigint<confirm_time and sign*((b->>'close')::numeric-(prices[1]+slope*((b->>'opened_at_server_raw')::bigint+300-times[1])))<-tol) then return false;end if;
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
revoke all on function public.valid_ch_plan(jsonb,jsonb) from public,anon,authenticated,service_role;

alter table public.signals drop constraint signals_strategy_check;
alter table public.signals add constraint signals_strategy_check check(strategy in ('QM','QMTR','BOS','CHOCH','TRENDLINE','TICK_VOLUME','HNS','CH'));
alter table public.signals add constraint signals_ch_timeframe_check check(strategy is distinct from 'CH' or timeframe in ('M15','M30','H1','H4'));
do $$ declare definition text;updated text;
begin
 definition=pg_get_functiondef('public.apply_automatic_engine(timestamptz,jsonb)'::regprocedure);
 if position('plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'')' in definition)=0 or position('if plan->>''method''=''HNS'' then' in definition)=0 then raise exception 'Unexpected engine definition; CH migration requires review';end if;
 updated=replace(definition,'plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'')','plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'',''CH'')');
 updated=replace(updated,'if plan->>''method''=''HNS'' then','if plan->>''method''=''CH'' then if not public.valid_ch_plan(feed.snapshot,plan) then raise exception ''CH break/retest evidence invalid'';end if; elsif plan->>''method''=''HNS'' then');
 updated=replace(updated,'''hns'',plan->''hns''','''ch'',plan->''ch'',''hns'',plan->''hns''');
 execute updated;
end;$$;
commit;
