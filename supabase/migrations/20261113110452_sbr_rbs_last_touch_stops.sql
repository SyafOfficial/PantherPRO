begin;
create function public.valid_role_reversal_plan(snapshot jsonb,plan jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare frame text=plan->>'timeframe';htf text;buy boolean=plan->>'direction'='BUY';sign numeric;event_time bigint=(plan->>'breakoutOpenedServer')::bigint;confirm_time bigint=(plan->>'confirmationOpenedServer')::bigint;event_index integer;bars jsonb;context jsonb;pivots jsonb;anchor jsonb;evidence jsonb=plan->'roleReversal';reference jsonb;expected_stop numeric;expected_id text;c jsonb;previous jsonb;level numeric;point_size numeric;lo numeric;hi numeric;wl numeric;wh numeric;range_size numeric;highs numeric[];lows numeric[];n integer;k integer;j integer;trend text;
begin
 if plan->>'method' is null or plan->>'direction' is null or plan->>'stop' is null or plan->>'method' not in ('SBR','RBS') or plan->>'direction' not in ('BUY','SELL') or evidence->>'version' is distinct from 'sbr-rbs-v1' or frame not in ('M15','M30','H1','H4','W1','MN1') then return false;end if;
 if event_time is null or confirm_time is null then return false;end if;
 if plan->>'method' is distinct from (case when buy then 'RBS' else 'SBR' end) or evidence->'breakout' is distinct from plan->'breakoutOpenedServer' or evidence->'retest' is distinct from plan->'confirmationOpenedServer' then return false;end if;
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
 if trend='range' then return false;end if;
 if sign*((bars->(event_index-1)->>'close')::numeric-level)>0 or sign*((bars->event_index->>'close')::numeric-level)<=0 then return false;end if;
 for j in (anchor->>'index')::integer+3..event_index-1 loop if sign*((bars->j->>'close')::numeric-level)>0 then return false;end if;end loop;
 -- Freeze the LAST touch in the prefix strictly before the breakout; never an extremum.
 for j in reverse event_index-1..(anchor->>'index')::integer loop
  if (bars->j->>'low')::numeric<=level and (bars->j->>'high')::numeric>=level then
   reference=jsonb_build_object('opened_at_server_raw',(bars->j->>'opened_at_server_raw')::bigint,'open',(bars->j->>'open')::numeric,'high',(bars->j->>'high')::numeric,'low',(bars->j->>'low')::numeric,'close',(bars->j->>'close')::numeric);exit;
  end if;
 end loop;
 if reference is null or reference is distinct from evidence->'reference' then return false;end if;
 if (snapshot->>'digits')::integer not between 0 and 10 or point_size is distinct from power(10::numeric,-(snapshot->>'digits')::integer) then return false;end if;
 expected_stop=case when buy then (ceil((reference->>'low')::numeric/point_size)-1)*point_size else (floor((reference->>'high')::numeric/point_size)+1)*point_size end;
 if expected_stop is distinct from (plan->>'stop')::numeric or expected_stop<=0 then return false;end if;
 expected_id=encode(sha256(convert_to(concat_ws(':','sbr-rbs-v1',snapshot->>'symbol',frame,plan->>'direction',anchor->>'at',event_time),'UTF8')),'hex');
 if plan->>'sourceEventId' is distinct from expected_id then return false;end if;
 for j in event_index+1..jsonb_array_length(bars)-1 loop if sign*((bars->j->>'close')::numeric-level)<0 then return false;end if;end loop;
 select b into c from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time;
 if c is null or confirm_time<public.base_bar_end(bars->event_index,frame) then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>confirm_time and (b->>'opened_at_server_raw')::bigint+300<=(snapshot->>'server_time_raw')::bigint) then return false;end if;
 select b into previous from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirm_time-300;
 if previous is null then return false;end if;
 lo=(c->>'low')::numeric;hi=(c->>'high')::numeric;
 if lo is distinct from (plan->>'zoneLow')::numeric or hi is distinct from (plan->>'zoneHigh')::numeric or (buy and expected_stop>=lo) or (not buy and expected_stop<=hi) then return false;end if;
 range_size=hi-lo;
 if range_size<=0 or lo>level or hi<level or sign*((c->>'close')::numeric-(c->>'open')::numeric)<range_size*.25 or (case when buy then (c->>'close')::numeric-lo else hi-(c->>'close')::numeric end)/range_size<.65 or sign*((c->>'close')::numeric-level)<=point_size*2 or (buy and (c->>'close')::numeric<=(previous->>'high')::numeric) or (not buy and (c->>'close')::numeric>=(previous->>'low')::numeric) then return false;end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'series')s cross join lateral jsonb_array_elements(s->'candles')b where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint>=public.base_bar_end(bars->event_index,frame) and (b->>'opened_at_server_raw')::bigint<confirm_time and sign*((b->>'close')::numeric-level)<-point_size*2) then return false;end if;
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
revoke all on function public.valid_role_reversal_plan(jsonb,jsonb) from public,anon,authenticated,service_role;
-- Additive methods only; old strategy stop validators and management are untouched.
alter table public.automatic_engine_policy add column role_reversal_schema_version text not null default 'sbr-rbs-v1' check(role_reversal_schema_version='sbr-rbs-v1');
alter table public.signals drop constraint signals_strategy_check;
alter table public.signals add constraint signals_strategy_check check(strategy in ('QM','QMTR','BOS','CHOCH','TRENDLINE','TICK_VOLUME','HNS','CH','SBR','RBS'));
alter table public.signals add constraint signals_role_reversal_direction check(
 (strategy is distinct from 'SBR' or direction='SELL') and (strategy is distinct from 'RBS' or direction='BUY')
);
-- Version remains v1: additive evidence discriminator sbr-rbs-v1, DB first then code.
-- Do not enable/alter the owner's existing engine policy in this migration.
do $$ declare definition text;updated text;overlap text;
begin
 definition=pg_get_functiondef('public.apply_automatic_engine(timestamptz,jsonb)'::regprocedure);
 if position('plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'',''CH'')' in definition)=0 or position('if plan->>''method'' in (''BOS'',''CHOCH'') then' in definition)=0 or position('''base'',plan->''base''' in definition)=0 then raise exception 'Unexpected engine definition; SBR/RBS migration requires review';end if;
 updated=replace(definition,'plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'',''CH'')','plan->>''method'' not in (''QM'',''BOS'',''CHOCH'',''TRENDLINE'',''HNS'',''CH'',''SBR'',''RBS'')');
 updated=replace(updated,'if plan->>''method'' in (''BOS'',''CHOCH'') then','if plan->>''method'' in (''SBR'',''RBS'') then if not public.valid_role_reversal_plan(feed.snapshot,plan) then raise exception ''SBR/RBS break/retest or last-touch stop evidence invalid'';end if; elsif plan->>''method'' in (''BOS'',''CHOCH'') then');
 updated=replace(updated,'''base'',plan->''base''','''roleReversal'',plan->''roleReversal'',''targetReasons'',plan->''targetReasons'',''base'',plan->''base''');
 -- Same-break and same-confirmation dedup with BOS/CHOCH, across later retests
 -- and rolling deployments. Kept inside the existing advisory-locked transaction.
 overlap=$patch$
   if plan->>'method' in ('SBR','RBS','BOS','CHOCH') and exists(
    select 1 from public.signals s join public.audit_logs a on a.entity_id=s.id and a.action='engine.signal_published'
    where s.source='mt5' and s.timeframe=plan->>'timeframe' and s.direction=plan->>'direction'
    and (s.strategy in ('SBR','RBS') or plan->>'method' in ('SBR','RBS'))
    and ((a.details->>'breakout_broker_time')::bigint=(plan->>'breakoutOpenedServer')::bigint
     or (a.details->>'confirmation_broker_time')::bigint=(plan->>'confirmationOpenedServer')::bigint)
   ) then continue;end if;
   select id into existing_id from public.signals$patch$;
 updated=replace(updated,'select id into existing_id from public.signals',overlap);
 if updated=definition then raise exception 'SBR/RBS engine patch failed';end if;
 execute updated;
end;$$;
commit;
