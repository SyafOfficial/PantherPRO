-- Receiver must support waiting/cancellation events before this migration is applied.
begin;
create or replace function public.prepare_telegram_signal_events() returns integer language plpgsql security definer set search_path='' as $$
declare item record;added integer=0;p public.telegram_signal_policy;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into p from public.telegram_signal_policy where singleton;
 if not p.enabled then return 0;end if;
 for item in
  select o.id as outbox_key,o.event_key,o.signal_id,o.event_type,o.created_at as event_at,s.*
  from public.notification_outbox o join public.signals s on s.id=o.signal_id
  where o.created_at>=p.starts_at and o.access='public' and s.published_at is not null and s.approved_by is not null
   and o.event_type in ('signal.waiting','signal.waiting_cancelled','signal.active','signal.tp1','signal.tp2','signal.tp3','signal.break_even','signal.stop_hit','signal.be_hit')
   and not exists(select 1 from public.telegram_signal_queue q where q.outbox_id=o.id)
   and (o.event_type in ('signal.waiting','signal.active') or exists(select 1 from public.telegram_signal_queue q where q.signal_id=o.signal_id and q.event_type in ('signal.waiting','signal.active') and q.state in ('pending','processing','delivered')))
  order by o.created_at,case when o.event_type='signal.waiting' then 0 when o.event_type='signal.active' then 1 else 2 end,o.id limit 100
 loop
  -- Do not forward orphan updates from signals published before this bridge was enabled.
  if item.event_type not in ('signal.waiting','signal.active') and not exists(select 1 from public.telegram_signal_queue q where q.signal_id=item.signal_id and q.event_type in ('signal.waiting','signal.active') and q.state in ('pending','processing','delivered')) then continue;end if;
  insert into public.telegram_signal_queue(outbox_id,event_key,signal_id,event_type,payload)
  values(item.outbox_key,item.event_key,item.signal_id,item.event_type,jsonb_build_object(
   'version','panther.signal.v1','eventId',item.outbox_key,'eventKey',item.event_key,'signalId',item.signal_id,'eventType',item.event_type,'eventAt',item.event_at,
   'signal',jsonb_build_object('instrument',item.instrument,'direction',item.direction,'entry',item.entry,'zoneLow',coalesce(item.entry_low,item.entry),'zoneHigh',coalesce(item.entry_high,item.entry),'stop',item.stop_loss,'tp1',item.tp1,'tp2',item.tp2,'tp3',item.tp3,'method',item.strategy,'timeframe',item.timeframe)
  )) on conflict do nothing;
  if found then added=added+1;end if;
 end loop;
 return added;
end;$$;

commit;
