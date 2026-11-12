begin;
create function public.base_bar_end(b jsonb,frame text) returns bigint language sql immutable strict security invoker set search_path='' as $$
 select case when frame='MN1' then extract(epoch from ((date_trunc('month',to_timestamp((b->>'opened_at_server_raw')::bigint) at time zone 'UTC')+interval '1 month') at time zone 'UTC'))::bigint else (b->>'opened_at_server_raw')::bigint+case frame when 'M5' then 300 when 'M15' then 900 when 'M30' then 1800 when 'H1' then 3600 when 'H4' then 14400 when 'W1' then 604800 end end;
$$;
revoke all on function public.base_bar_end(jsonb,text) from public,anon,authenticated,service_role;
create function public.origin_base(bars jsonb,event_index integer,buy boolean,level numeric,point_size numeric) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare sign numeric=case when buy then 1 else -1 end;last_index integer=event_index-1;first_index integer;i integer;lo numeric;hi numeric;wl numeric;wh numeric;overlap_low numeric;overlap_high numeric;b jsonb;departure jsonb;
begin
 if event_index is null or event_index<1 or event_index>=jsonb_array_length(bars) or level is null or point_size is null or buy is null then return null;end if;
 if sign*((bars->event_index->>'close')::numeric-(bars->event_index->>'open')::numeric)<=0 then return null;end if;
 while last_index>=greatest(0,event_index-6) and sign*((bars->last_index->>'close')::numeric-(bars->last_index->>'open')::numeric)>=0 loop last_index=last_index-1;end loop;
 if last_index<greatest(0,event_index-6) then return null;end if;
 first_index=last_index;
 while first_index>0 and sign*((bars->(first_index-1)->>'close')::numeric-(bars->(first_index-1)->>'open')::numeric)<0 and last_index-first_index<2 loop first_index=first_index-1;end loop;
 if last_index-first_index>=2 then return null;end if;
 for i in first_index..last_index loop
  b=bars->i;
  if (b->>'high')::numeric<=(b->>'low')::numeric or abs((b->>'close')::numeric-(b->>'open')::numeric)>((b->>'high')::numeric-(b->>'low')::numeric)*.5 then return null;end if;
  lo=least(lo,least((b->>'open')::numeric,(b->>'close')::numeric));hi=greatest(hi,greatest((b->>'open')::numeric,(b->>'close')::numeric));
  wl=least(wl,(b->>'low')::numeric);wh=greatest(wh,(b->>'high')::numeric);overlap_low=greatest(overlap_low,(b->>'low')::numeric);overlap_high=least(overlap_high,(b->>'high')::numeric);
 end loop;
 if lo>=hi or (buy and hi>=level-point_size) or (not buy and lo<=level+point_size) or overlap_low>overlap_high then return null;end if;
 departure=bars->(last_index+1);
 if sign*((departure->>'close')::numeric-(departure->>'open')::numeric)<((departure->>'high')::numeric-(departure->>'low')::numeric)*.6 or (buy and (departure->>'close')::numeric<=hi) or (not buy and (departure->>'close')::numeric>=lo) then return null;end if;
 for i in last_index+1..event_index loop if (buy and (bars->i->>'close')::numeric<=lo) or (not buy and (bars->i->>'close')::numeric>=hi) then return null;end if;end loop;
 return jsonb_build_object('start',(bars->first_index->>'opened_at_server_raw')::bigint,'end',(bars->last_index->>'opened_at_server_raw')::bigint,'departure',(departure->>'opened_at_server_raw')::bigint,'zoneLow',lo,'zoneHigh',hi,'wickLow',wl,'wickHigh',wh);
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;$$;
revoke all on function public.origin_base(jsonb,integer,boolean,numeric,numeric) from public,anon,authenticated,service_role;
create function public.valid_base_retest_plan(snapshot jsonb,plan jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare frame text=plan->>'timeframe';htf text;buy boolean=plan->>'direction'='BUY';sign numeric;event_time bigint=(plan->>'breakoutOpenedServer')::bigint;confirm_time bigint=(plan->>'confirmationOpenedServer')::bigint;event_index integer;bars jsonb;context jsonb;pivots jsonb;anchor jsonb;evidence jsonb=plan->'base';base jsonb;c jsonb;level numeric;point_size numeric;lo numeric;hi numeric;wl numeric;wh numeric;range_size numeric;highs numeric[];lows numeric[];n integer;k integer;j integer;trend text;
begin
 if plan->>'method' is null or plan->>'direction' is null or plan->>'stop' is null or plan->>'method' not in ('BOS','CHOCH') or plan->>'direction' not in ('BUY','SELL') or evidence->>'version' is distinct from 'structure-base-v2' or frame not in ('M15','M30','H1','H4','W1','MN1') then return false;end if;
 if event_time is null or confirm_time is null then return false;end if;
 sign=case when buy then 1 else -1 end;level=(evidence->>'level')::numeric;point_size=(snapshot->>'point')::numeric;
 if level is null or point_size is null or level<=0 or point_size<=0 or (snapshot->>'server_time_raw')::bigint-(confirm_time+300) not between 0 and 300 then return false;end if;
 htf=case frame when 'M15' then 'M30' when 'M30' then 'H1' when 'H1' then 'H4' when 'H4' then 'W1' when 'W1' then 'MN1' end;
 if plan->>'higherTimeframe' is distinct from htf then return false;end if;
 select coalesce(jsonb_agg(b order by (b->>'opened_at_server_raw')::bigint),'[]') into bars from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'=frame and public.base_bar_end(b,frame)<=confirm_time;
 select ordinality::integer-1 into event_index from jsonb_array_elements(bars) with ordinality b where (value->>'opened_at_server_raw')::bigint=event_time;
 if event_index is null or event_index<14 or event_index<jsonb_array_length(bars)-12 then return false;end if;
 pivots=public.hns_pivots(bars,event_index,false);
 select p into anchor from jsonb_array_elements(pivots) with ordinality q(p,ordinality) where p->>'kind'=case when buy then 'high' else 'low' end order by ordinality desc limit 1;
 if anchor is null or (anchor->>'at')::bigint is distinct from (evidence->>'anchor')::bigint or (anchor->>'price')::numeric is distinct from level then return false;end if;
 select array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='high'),array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='low') into highs,lows from jsonb_array_elements(pivots) with ordinality q(p,ordinality);
 n=coalesce(array_length(highs,1),0);k=coalesce(array_length(lows,1),0);if n<2 or k<2 then return false;end if;
 trend=case when highs[n]>highs[n-1] and lows[k]>lows[k-1] then 'up' when highs[n]<highs[n-1] and lows[k]<lows[k-1] then 'down' else 'range' end;
 if trend='range' or plan->>'method' is distinct from (case when (buy and trend='up') or (not buy and trend='down') then 'BOS' else 'CHOCH' end) then return false;end if;
 if sign*((bars->(event_index-1)->>'close')::numeric-level)>0 or sign*((bars->event_index->>'close')::numeric-level)<=0 then return false;end if;
 for j in (anchor->>'index')::integer+3..event_index-1 loop if sign*((bars->j->>'close')::numeric-level)>0 then return false;end if;end loop;
 base=public.origin_base(bars,event_index,buy,level,point_size);if base is null then return false;end if;
 if base->'start' is distinct from evidence->'start' or base->'end' is distinct from evidence->'end' or base->'departure' is distinct from evidence->'departure' then return false;end if;
 lo=(base->>'zoneLow')::numeric;hi=(base->>'zoneHigh')::numeric;wl=(base->>'wickLow')::numeric;wh=(base->>'wickHigh')::numeric;
 if lo is distinct from (plan->>'zoneLow')::numeric or hi is distinct from (plan->>'zoneHigh')::numeric or abs((plan->>'stop')::numeric-(case when buy then wl else wh end))>0.000001 then return false;end if;
 for j in event_index+1..jsonb_array_length(bars)-1 loop if (buy and (bars->j->>'close')::numeric<=wl) or (not buy and (bars->j->>'close')::numeric>=wh) then return false;end if;end loop;
 select b into c from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time;
 if c is null or confirm_time<public.base_bar_end(bars->event_index,frame) then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>confirm_time and (b->>'opened_at_server_raw')::bigint+300<=(snapshot->>'server_time_raw')::bigint) then return false;end if;
 range_size=(c->>'high')::numeric-(c->>'low')::numeric;
 if range_size<=0 or (c->>'low')::numeric>hi or (c->>'high')::numeric<lo or sign*((c->>'close')::numeric-(c->>'open')::numeric)<range_size*.25 or (case when buy then (c->>'close')::numeric-(c->>'low')::numeric else (c->>'high')::numeric-(c->>'close')::numeric end)/range_size<.65 or (buy and (c->>'close')::numeric<=hi+point_size*2) or (not buy and (c->>'close')::numeric>=lo-point_size*2) then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>=public.base_bar_end(bars->event_index,frame) and (b->>'opened_at_server_raw')::bigint<=confirm_time and ((buy and (b->>'close')::numeric<=wl) or (not buy and (b->>'close')::numeric>=wh))) then return false;end if;
 if htf is not null then
  select coalesce(jsonb_agg(b order by (b->>'opened_at_server_raw')::bigint),'[]') into context from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'=htf and public.base_bar_end(b,htf)<=confirm_time+300;
  if jsonb_array_length(context)<10 then return false;end if;
  pivots=public.hns_pivots(context,jsonb_array_length(context)-1,false);
  select array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='high'),array_agg((p->>'price')::numeric order by ordinality) filter(where p->>'kind'='low') into highs,lows from jsonb_array_elements(pivots) with ordinality q(p,ordinality);
  n=coalesce(array_length(highs,1),0);k=coalesce(array_length(lows,1),0);if n<2 or k<2 or sign*(highs[n]-highs[n-1])<=0 or sign*(lows[k]-lows[k-1])<=0 then return false;end if;
 end if;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or division_by_zero then return false;
end;$$;
revoke all on function public.valid_base_retest_plan(jsonb,jsonb) from public,anon,authenticated,service_role;
-- Monitor existing signals normally while older workers drain. Their obsolete
-- BOS/CHOCH proposals are ignored; only independently validated base plans publish.
do $$ declare definition text;updated text;
begin
 definition=pg_get_functiondef('public.apply_automatic_engine(timestamptz,jsonb)'::regprocedure);
 if position('if plan->>''method''=''CH'' then' in definition)=0 or position('if exists(select 1 from public.retired_signal_keys' in definition)=0 then raise exception 'Unexpected engine definition; base migration requires review';end if;
 updated=replace(definition,'if exists(select 1 from public.retired_signal_keys','if plan->>''method'' in (''BOS'',''CHOCH'') and not (plan ? ''base'') then continue;end if; if exists(select 1 from public.retired_signal_keys');
 updated=replace(updated,'if plan->>''method''=''CH'' then','if plan->>''method'' in (''BOS'',''CHOCH'') then if not public.valid_base_retest_plan(feed.snapshot,plan) then raise exception ''Structure base retest evidence invalid'';end if; elsif plan->>''method''=''CH'' then');
 updated=replace(updated,'''ch'',plan->''ch''','''base'',plan->''base'',''ch'',plan->''ch''');
 execute updated;
end;$$;
commit;
