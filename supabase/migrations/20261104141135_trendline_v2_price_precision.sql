-- Service-only validation; derive the structural stop from the accepted snapshot,
-- rather than trusting a numeric stop or new model label from a plan.
create or replace function public.valid_trendline_v2_plan(snapshot jsonb, plan jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare evidence jsonb=plan->'trendline'; bars jsonb; c jsonb; event_bar jsonb; anchor_bar jsonb;
 atr numeric; buffer numeric; extreme numeric; expected numeric; buy boolean=plan->>'direction'='BUY';
 event_time bigint; confirmation_time bigint; first_time bigint; second_time bigint;
 spread numeric; point_size numeric; worst_entry numeric; sign numeric;
begin
 if plan->>'stop' is null or plan->>'zoneLow' is null or plan->>'zoneHigh' is null or plan->'targets'->>0 is null then return false;end if;
 if plan->>'method' is distinct from 'TRENDLINE' or evidence->>'version' is distinct from 'trendline-v2'
  or evidence->>'subtype' not in ('bounce','breakout_retest') or evidence->>'subtype' is null
  or jsonb_typeof(evidence->'anchors') is distinct from 'array' or jsonb_array_length(evidence->'anchors')<>2
  then return false;end if;
 event_time=(evidence->>'eventOpened')::bigint; confirmation_time=(evidence->>'confirmationOpened')::bigint;
 first_time=(evidence->'anchors'->>0)::bigint;second_time=(evidence->'anchors'->>1)::bigint;
 if first_time is null or second_time is null or event_time is null or confirmation_time is null
  or first_time>=second_time or second_time>=event_time or event_time>=confirmation_time
  or event_time is distinct from (plan->>'breakoutOpenedServer')::bigint
  or confirmation_time is distinct from (plan->>'confirmationOpenedServer')::bigint then return false;end if;
 select s->'candles' into bars from jsonb_array_elements(snapshot->'series') s where s->>'timeframe'=plan->>'timeframe';
 if bars is null then return false;end if;
 if not exists(select 1 from jsonb_array_elements(bars) b where (b->>'opened_at_server_raw')::bigint=first_time)
  or (select count(*) from jsonb_array_elements(bars) b where (b->>'opened_at_server_raw')::bigint between first_time and second_time)<6
  or (select count(*) from jsonb_array_elements(bars) b where (b->>'opened_at_server_raw')::bigint>second_time and (b->>'opened_at_server_raw')::bigint<event_time)<2
  then return false;end if;
 select b into event_bar from jsonb_array_elements(bars) b where (b->>'opened_at_server_raw')::bigint=event_time;
 select b into anchor_bar from jsonb_array_elements(bars) b where (b->>'opened_at_server_raw')::bigint=second_time;
 select b into c from jsonb_array_elements(snapshot->'series') s cross join lateral jsonb_array_elements(s->'candles') b
  where s->>'timeframe'='M5' and (b->>'opened_at_server_raw')::bigint=confirmation_time;
 if event_bar is null or anchor_bar is null or c is null
  or (c->>'low')::numeric is distinct from (plan->>'zoneLow')::numeric
  or (c->>'high')::numeric is distinct from (plan->>'zoneHigh')::numeric then return false;end if;
 select avg(tr) into atr from (
  select greatest(high-low,abs(high-previous_close),abs(low-previous_close)) as tr from (
   select (b->>'opened_at_server_raw')::bigint as stamp,(b->>'high')::numeric high,(b->>'low')::numeric low,
    lag((b->>'close')::numeric) over(order by (b->>'opened_at_server_raw')::bigint) previous_close
   from jsonb_array_elements(bars) b where (b->>'opened_at_server_raw')::bigint<event_time
  ) history where previous_close is not null order by stamp desc limit 14
 ) ranges;
 spread=(snapshot->'quote'->>'ask')::numeric-(snapshot->'quote'->>'bid')::numeric;
 point_size=(snapshot->>'point')::numeric;
 if atr is null or atr<=0 or spread is null or spread<0 or point_size is null or point_size<=0 then return false;end if;
 buffer=greatest(atr*0.15,spread*2,point_size*2);
 if evidence->>'subtype'='bounce' then
  extreme=case when buy then least((anchor_bar->>'low')::numeric,(c->>'low')::numeric)
   else greatest((anchor_bar->>'high')::numeric,(c->>'high')::numeric) end;
 else
  extreme=case when buy then least((event_bar->>'low')::numeric,(c->>'low')::numeric)
   else greatest((event_bar->>'high')::numeric,(c->>'high')::numeric) end;
 end if;
 sign=case when buy then 1 else -1 end;expected=extreme-sign*buffer;
 if evidence ? 'precision' then
  if evidence->>'precision' is distinct from 'point' then return false;end if;
  expected=case when buy then floor((expected+0.000000001)/point_size) else ceil((expected-0.000000001)/point_size) end*point_size;
 end if;
 worst_entry=case when buy then (plan->>'zoneHigh')::numeric else (plan->>'zoneLow')::numeric end;
 if expected<=0 or abs((plan->>'stop')::numeric-expected)>0.000001
  or sign*(worst_entry-expected)<=0
  or sign*((plan->'targets'->>0)::numeric-worst_entry)/ (sign*(worst_entry-expected))<1.5 then return false;end if;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or division_by_zero then return false;
end;$$;
revoke all on function public.valid_trendline_v2_plan(jsonb,jsonb) from public,anon,authenticated,service_role;

