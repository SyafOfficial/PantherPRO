begin;
-- One authenticated member audience. Keep administrator authority and login requirements.
alter function public.has_vip() rename to is_member;
CREATE OR REPLACE FUNCTION public.apply_tick_volume(export_time timestamp with time zone, proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 if exists(select 1 from public.retired_signal_keys where source='mt5' and source_event_id=event_id) or exists(select 1 from public.signals where source='mt5' and source_event_id=event_id) then return jsonb_build_object('published',0,'reason','duplicate');end if;
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
 values('XAUUSD',proposal->>'direction',entry_price,entry_price,entry_price,stop_price,targets[1],targets[2],targets[3],reason,'public','mt5',event_id,event_id,feed.exported_at,null,'TICK_VOLUME','M5','tick-volume-momentum-v1') returning id into new_id;
 update public.signals set status='active',approved_by=policy.approved_by,published_at=now(),pricing_source='Vestrado MT5: observed feed, no broker fill' where id=new_id;
 insert into public.automatic_engine_tracking(signal_id,last_snapshot,last_m5_open) values(new_id,export_time,stamp);
 insert into public.notification_outbox(event_key,signal_id,event_type,access) values(new_id::text||':active',new_id,'signal.active','public');
 insert into public.audit_logs(actor_id,action,entity_id,details) values(policy.approved_by,'engine.tick_volume_published',new_id,jsonb_build_object('execution','hypothetical','volume_ratio',ratio,'confirmation_open',stamp));
 update public.tick_volume_policy set last_result=jsonb_build_object('published',1,'signal_id',new_id,'observed_at',now()) where singleton;
 return jsonb_build_object('published',1,'signal_id',new_id);
end; $function$;
CREATE OR REPLACE FUNCTION public.is_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('public','admin'));
$function$;
CREATE OR REPLACE FUNCTION public.notification_allowed(event_id uuid, device_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.notification_outbox o
 join public.push_subscriptions s on s.id=device_id and s.active
 join public.profiles p on p.id=s.user_id
 join public.notification_preferences n on n.user_id=p.id and n.push_enabled
 where o.id=event_id and o.created_at>now()-interval '24 hours'
 and (o.recipient_id is null or o.recipient_id=p.id)
 and (o.access='public' or p.role in ('public','admin'))
 and (o.signal_id is null or exists(select 1 from public.signals x where x.id=o.signal_id and x.published_at is not null and (x.access='public' or p.role in ('public','admin'))))
 and (o.calendar_event_id is null or exists(select 1 from public.calendar_events e join public.data_providers p on p.id=e.provider_id and p.enabled and p.display_allowed where e.id=o.calendar_event_id and (o.event_type<>'news.released' or e.actual is not null) and (o.event_type<>'news.upcoming' or (e.actual is null and e.event_time>now() and (o.payload->>'scheduled_at')::timestamptz=e.event_time))))
 and case when o.event_type='push.test' then o.recipient_id=p.id
  when o.event_type in ('signal.active','signal.modified','signal.closed') then n.signals
  when o.event_type in ('signal.stop_loss','signal.tp1','signal.tp2','signal.tp3','signal.break_even','signal.be_hit','signal.stop_hit') then n.targets
  when o.event_type in ('news.upcoming','news.released') then n.news
  when o.event_type='announcement.published' then n.announcements else false end);
$function$;

alter table public.signals drop constraint engine_entry_zone;
update public.profiles set role='public' where role='vip';
update public.signals set access='public' where access='vip';
update public.announcements set access='public' where access='vip';
update public.notification_outbox set access='public' where access='vip';
alter table public.signals add constraint engine_entry_zone check(
 (engine_version is null and entry_low is null and entry_high is null) or
 (engine_version='vestrado-structure-v1' and source='mt5' and entry_low>0 and entry_high>=entry_low and entry between entry_low and entry_high and entry_high-entry_low<=8) or
 (engine_version='tick-volume-momentum-v1' and source='mt5' and entry_low=entry and entry_high=entry and access='public')
);
alter table public.signals drop constraint signals_access_check;
alter table public.announcements drop constraint announcements_access_check;
alter table public.notification_outbox drop constraint notification_outbox_access_check;
alter table public.profiles add constraint profiles_member_or_admin check(role in ('public','admin'));
alter table public.signals add constraint signals_member_audience check(access='public');
alter table public.announcements add constraint announcements_member_audience check(access='public');
alter table public.notification_outbox add constraint outbox_member_audience check(access='public');
drop function public.set_member_role(uuid,text);
drop table public.membership_entitlements;
-- Existing enum history is retained; constraints prevent the retired tier returning.
commit;


