begin;
create table public.data_providers (
 id uuid primary key default gen_random_uuid(),display_name text not null check(length(display_name) between 1 and 120),
 kind text not null check(kind in ('quotes','calendar')),license_reference text not null check(length(trim(license_reference)) between 1 and 500),
 enabled boolean not null default false,display_allowed boolean not null default false,reconciliation_allowed boolean not null default false,
 max_gap_seconds integer not null default 60 check(max_gap_seconds between 1 and 3600),created_at timestamptz not null default now()
);
create table public.market_quotes (
 id uuid primary key default gen_random_uuid(),provider_id uuid not null references public.data_providers(id),reference text not null check(length(reference) between 1 and 200),
 instrument text not null check(instrument='XAUUSD'),bid numeric(14,4) not null check(bid>0),ask numeric(14,4) not null check(ask>=bid),
 observed_at timestamptz not null,received_at timestamptz not null default now(),source_name text not null,max_gap_seconds integer not null,
 unique(provider_id,reference),unique(provider_id,observed_at)
);
create index market_quotes_latest on public.market_quotes(observed_at desc);
create table public.calendar_events (
 id uuid primary key default gen_random_uuid(),provider_id uuid not null references public.data_providers(id),reference text not null check(length(reference) between 1 and 200),
 name text not null check(length(name) between 1 and 200),country text not null check(country='United States'),currency text not null check(currency='USD'),
 event_time timestamptz not null,previous text check(length(trim(previous)) between 1 and 100),forecast text check(length(trim(forecast)) between 1 and 100),actual text check(length(trim(actual)) between 1 and 100),
 importance text not null check(importance in ('low','medium','high')),source_updated_at timestamptz not null,source_url text not null check(source_url ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'),
 source_name text not null,received_at timestamptz not null default now(),version integer not null default 1,unique(provider_id,reference)
);
create index calendar_events_time on public.calendar_events(event_time);
create table public.calendar_event_revisions (
 id bigint generated always as identity primary key,event_id uuid not null references public.calendar_events(id),version integer not null,
 observation jsonb not null,received_at timestamptz not null default now(),unique(event_id,version)
);
alter table public.notification_outbox add column calendar_event_id uuid references public.calendar_events(id);
alter table public.signals add column observation_quote_id uuid references public.market_quotes(id);
alter table public.signals add column observation_entry numeric(14,4);
alter table public.signals add column observation_started_at timestamptz;
alter table public.signals add column last_quote_id uuid references public.market_quotes(id);
alter table public.signals add column stop_observed_at timestamptz;
alter table public.signals add column reconciliation_state text not null default 'not_started' check(reconciliation_state in ('not_started','observing','gap','stopped'));
alter table public.signals add constraint finite_signal_prices check(entry<>'NaN'::numeric and stop_loss<>'NaN'::numeric and tp1<>'NaN'::numeric and tp2<>'NaN'::numeric and tp3<>'NaN'::numeric);
alter table public.market_quotes add constraint finite_quote_prices check(bid<>'NaN'::numeric and ask<>'NaN'::numeric);
create function public.provider_display_allowed(source_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.data_providers where id=source_id and enabled and display_allowed);
$$;
alter table public.data_providers enable row level security;
alter table public.market_quotes enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_revisions enable row level security;
create policy providers_admin on public.data_providers for select to authenticated using(public.is_admin());
create policy quotes_read on public.market_quotes for select to authenticated using(public.is_admin() or public.provider_display_allowed(provider_id));
create policy calendar_read on public.calendar_events for select to authenticated using(public.is_admin() or public.provider_display_allowed(provider_id));
create policy calendar_revisions_admin on public.calendar_event_revisions for select to authenticated using(public.is_admin());
revoke all on public.data_providers,public.market_quotes,public.calendar_events,public.calendar_event_revisions from anon,authenticated;
grant select on public.data_providers,public.market_quotes,public.calendar_events,public.calendar_event_revisions to authenticated;
create function public.start_signal_observation(signal_id uuid,quote_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.signals;q public.market_quotes;p public.data_providers;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 select * into s from public.signals where id=signal_id for update;
 if not found or s.status<>'active' or s.observation_quote_id is not null then raise exception 'Unobserved active signal required';end if;
 select * into q from public.market_quotes where id=quote_id;
 if not found then raise exception 'Quote required';end if;
 select * into p from public.data_providers where id=q.provider_id;
 if not p.enabled or not p.reconciliation_allowed or q.observed_at<s.published_at or q.observed_at<now()-make_interval(secs=>p.max_gap_seconds) then raise exception 'Fresh permitted quote after publication required';end if;
 -- Explicit quote-touch limit model; this is not a broker fill or an executed order.
 if not ((s.direction='BUY' and q.ask<=s.entry and q.bid>s.stop_loss) or (s.direction='SELL' and q.bid>=s.entry and q.ask<s.stop_loss)) then raise exception 'Quote does not establish an unambiguous observation baseline';end if;
 update public.signals set observation_quote_id=q.id,last_quote_id=q.id,observation_entry=case when s.direction='BUY' then q.ask else q.bid end,observation_started_at=q.observed_at,reconciliation_state='observing',pricing_source=q.source_name,max_favorable_movement=0,updated_at=now(),version=version+1 where id=s.id;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'signal.observation_started',s.id,jsonb_build_object('quote_id',q.id,'model','quote_touch_v1','not_a_broker_fill',true));
end;
$$;
create function public.reconcile_market_quote(quote_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare q public.market_quotes;previous_quote public.market_quotes;baseline public.market_quotes;s public.signals;p public.data_providers;executable numeric;favorable numeric;touched boolean;total integer=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into q from public.market_quotes where id=quote_id;if not found then raise exception 'Quote not found';end if;
 select * into p from public.data_providers where id=q.provider_id;
 if not p.enabled or not p.reconciliation_allowed then return 0;end if;
 for s in select * from public.signals where status='active' and reconciliation_state='observing' order by id for update loop
  select * into baseline from public.market_quotes where id=s.observation_quote_id;
  if baseline.provider_id<>q.provider_id then continue;end if;
  select * into previous_quote from public.market_quotes where id=s.last_quote_id;
  if q.observed_at<=previous_quote.observed_at then continue;end if;
  if q.observed_at-previous_quote.observed_at>make_interval(secs=>p.max_gap_seconds) then
   update public.signals set reconciliation_state='gap',updated_at=now(),version=version+1 where id=s.id;
   insert into public.audit_logs(action,entity_id,details) values('signal.observation_gap',s.id,jsonb_build_object('previous_quote',previous_quote.id,'next_quote',q.id));continue;
  end if;
  executable=case when s.direction='BUY' then q.bid else q.ask end;
  favorable=greatest(0,case when s.direction='BUY' then executable-s.observation_entry else s.observation_entry-executable end);
  touched=case when s.direction='BUY' then executable<=s.stop_loss else executable>=s.stop_loss end;
  if touched then
   insert into public.audit_logs(action,entity_id,details) values('signal.stop_observed',s.id,jsonb_build_object('quote_id',q.id,'observation_only',true));
   update public.signals set stop_observed_at=q.observed_at,reconciliation_state='stopped' where id=s.id;
   insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(s.id||':stop-observed',s.id,'signal.stop_hit',s.access,jsonb_build_object('quote_id',q.id,'observation_only',true)) on conflict(event_key) do nothing;
  else
   if s.tp1_hit_at is null and (case when s.direction='BUY' then executable>=s.tp1 else executable<=s.tp1 end) then
    update public.signals set tp1_hit_at=q.observed_at where id=s.id;
    insert into public.audit_logs(action,entity_id,details) values('signal.tp1_observed',s.id,jsonb_build_object('quote_id',q.id,'observation_only',true));
    insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(s.id||':tp1',s.id,'signal.tp1',s.access,jsonb_build_object('quote_id',q.id,'observation_only',true)) on conflict(event_key) do nothing;
   end if;
   if s.tp2_hit_at is null and (case when s.direction='BUY' then executable>=s.tp2 else executable<=s.tp2 end) then
    update public.signals set tp2_hit_at=q.observed_at where id=s.id;
    insert into public.audit_logs(action,entity_id,details) values('signal.tp2_observed',s.id,jsonb_build_object('quote_id',q.id,'observation_only',true));
    insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(s.id||':tp2',s.id,'signal.tp2',s.access,jsonb_build_object('quote_id',q.id,'observation_only',true)) on conflict(event_key) do nothing;
   end if;
   if s.tp3_hit_at is null and (case when s.direction='BUY' then executable>=s.tp3 else executable<=s.tp3 end) then
    update public.signals set tp3_hit_at=q.observed_at where id=s.id;
    insert into public.audit_logs(action,entity_id,details) values('signal.tp3_observed',s.id,jsonb_build_object('quote_id',q.id,'observation_only',true));
    insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(s.id||':tp3',s.id,'signal.tp3',s.access,jsonb_build_object('quote_id',q.id,'observation_only',true)) on conflict(event_key) do nothing;
   end if;
  end if;
  update public.signals set max_favorable_movement=greatest(coalesce(max_favorable_movement,0),favorable),last_quote_id=q.id,updated_at=now() where id=s.id;
  total=total+1;
 end loop;return total;
end;
$$;
create function public.ingest_market_quote(observation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.data_providers;q public.market_quotes;new_id uuid;observed timestamptz;latest timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into p from public.data_providers where id=(observation->>'provider_id')::uuid for update;
 if not found or p.kind<>'quotes' or not p.enabled then raise exception 'Enabled licensed quote provider required';end if;
 observed=(observation->>'observed_at')::timestamptz;
 select * into q from public.market_quotes where provider_id=p.id and reference=observation->>'reference';
 if found then
  if q.observed_at is distinct from observed or q.bid is distinct from (observation->>'bid')::numeric or q.ask is distinct from (observation->>'ask')::numeric or q.instrument is distinct from observation->>'instrument' then raise exception 'Conflicting quote reference';end if;
  return jsonb_build_object('id',q.id,'duplicate',true);
 end if;
 if observed is null or observed<now()-make_interval(secs=>p.max_gap_seconds) or observed>now()+interval '5 seconds' then raise exception 'Quote outside freshness window';end if;
 select max(observed_at) into latest from public.market_quotes where provider_id=p.id;
 if observed<=latest then raise exception 'Out-of-order quote';end if;
 insert into public.market_quotes(provider_id,reference,instrument,bid,ask,observed_at,source_name,max_gap_seconds) values(p.id,observation->>'reference',observation->>'instrument',(observation->>'bid')::numeric,(observation->>'ask')::numeric,observed,p.display_name,p.max_gap_seconds) returning id into new_id;
 perform public.reconcile_market_quote(new_id);
 return jsonb_build_object('id',new_id,'duplicate',false);
end;
$$;
create function public.ingest_calendar_event(observation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.data_providers;existing public.calendar_events;current_event public.calendar_events;source_time timestamptz;released boolean=false;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into p from public.data_providers where id=(observation->>'provider_id')::uuid for update;
 if not found or p.kind<>'calendar' or not p.enabled then raise exception 'Enabled licensed calendar provider required';end if;
 source_time=(observation->>'source_updated_at')::timestamptz;
 if source_time is null or source_time>now()+interval '5 seconds' then raise exception 'Invalid source timestamp';end if;
 if observation->>'actual' is not null and (observation->>'event_time')::timestamptz>now()+interval '5 seconds' then raise exception 'Actual figure cannot precede release';end if;
 select * into existing from public.calendar_events where provider_id=p.id and reference=observation->>'reference' for update;
 if found then
  if source_time<existing.source_updated_at then raise exception 'Stale calendar revision';end if;
  if source_time=existing.source_updated_at then
   if exists(select 1 from public.calendar_event_revisions where event_id=existing.id and version=existing.version and calendar_event_revisions.observation=ingest_calendar_event.observation) then return jsonb_build_object('id',existing.id,'duplicate',true);end if;
   raise exception 'Conflicting calendar revision';
  end if;
 end if;
 released=(observation->>'actual' is not null and existing.actual is null);
 insert into public.calendar_events(provider_id,reference,name,country,currency,event_time,previous,forecast,actual,importance,source_updated_at,source_url,source_name)
 values(p.id,observation->>'reference',observation->>'name',observation->>'country',observation->>'currency',(observation->>'event_time')::timestamptz,observation->>'previous',observation->>'forecast',observation->>'actual',observation->>'importance',source_time,observation->>'source_url',p.display_name)
 on conflict(provider_id,reference) do update set name=excluded.name,country=excluded.country,currency=excluded.currency,event_time=excluded.event_time,previous=excluded.previous,forecast=excluded.forecast,actual=excluded.actual,importance=excluded.importance,source_updated_at=excluded.source_updated_at,source_url=excluded.source_url,received_at=now(),version=public.calendar_events.version+1 returning * into current_event;
 insert into public.calendar_event_revisions(event_id,version,observation) values(current_event.id,current_event.version,observation);
 insert into public.audit_logs(action,entity_id,details) values('calendar.updated',current_event.id,jsonb_build_object('provider_id',p.id,'version',current_event.version));
 if released and current_event.event_time>now()-interval '1 hour' and p.display_allowed then
  insert into public.notification_outbox(event_key,calendar_event_id,event_type,access,payload) values('calendar:'||current_event.id||':released',current_event.id,'news.released','public',jsonb_build_object('calendar_event_id',current_event.id)) on conflict(event_key) do nothing;
 end if;
 return jsonb_build_object('id',current_event.id,'duplicate',false);
end;
$$;
create function public.queue_upcoming_calendar_events() returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 insert into public.notification_outbox(event_key,calendar_event_id,event_type,access,payload)
 select 'calendar:'||e.id||':upcoming:'||extract(epoch from e.event_time),e.id,'news.upcoming','public',jsonb_build_object('calendar_event_id',e.id,'scheduled_at',e.event_time)
 from public.calendar_events e join public.data_providers p on p.id=e.provider_id and p.enabled and p.display_allowed
 where e.importance='high' and e.actual is null and e.event_time>now() and e.event_time<=now()+interval '30 minutes' on conflict(event_key) do nothing;
 get diagnostics total=row_count;return total;
end;
$$;

create function public.get_market_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 return jsonb_build_object('quote',(select to_jsonb(q)||jsonb_build_object('max_gap_seconds',p.max_gap_seconds) from public.market_quotes q join public.data_providers p on p.id=q.provider_id where p.enabled and p.display_allowed order by q.observed_at desc limit 1),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.event_time) from (select * from public.calendar_events where public.provider_display_allowed(provider_id) and event_time between now()-interval '1 day' and now()+interval '30 days' order by event_time limit 100) e),'[]'::jsonb),'as_of',now());
end;
$$;
create function public.protect_observed_levels() returns trigger language plpgsql set search_path='' as $$
begin
 if (old.tp1_hit_at is not null and new.tp1<>old.tp1) or (old.tp2_hit_at is not null and new.tp2<>old.tp2) or (old.tp3_hit_at is not null and new.tp3<>old.tp3) then raise exception 'Observed target levels cannot be rewritten';end if;
 if old.reconciliation_state in ('gap','stopped') and (new.stop_loss<>old.stop_loss or new.tp1<>old.tp1 or new.tp2<>old.tp2 or new.tp3<>old.tp3) then raise exception 'Observation stopped; close or review before further price edits';end if;
 return new;
end;
$$;
create trigger protect_observed_signal before update on public.signals for each row execute function public.protect_observed_levels();

create or replace function public.notification_allowed(event_id uuid,device_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notification_outbox o
 join public.push_subscriptions s on s.id=device_id and s.active
 join public.profiles p on p.id=s.user_id
 join public.notification_preferences n on n.user_id=p.id and n.push_enabled
 where o.id=event_id and o.created_at>now()-interval '24 hours'
 and (o.recipient_id is null or o.recipient_id=p.id)
 and (o.access='public' or p.role in ('vip','admin'))
 and (o.signal_id is null or exists(select 1 from public.signals x where x.id=o.signal_id and x.published_at is not null and (x.access='public' or p.role in ('vip','admin'))))
 and (o.calendar_event_id is null or exists(select 1 from public.calendar_events e join public.data_providers p on p.id=e.provider_id and p.enabled and p.display_allowed where e.id=o.calendar_event_id and (o.event_type<>'news.released' or e.actual is not null) and (o.event_type<>'news.upcoming' or (e.actual is null and e.event_time>now() and (o.payload->>'scheduled_at')::timestamptz=e.event_time))))
 and case when o.event_type='push.test' then o.recipient_id=p.id
  when o.event_type in ('signal.active','signal.modified','signal.closed') then n.signals
  when o.event_type in ('signal.stop_loss','signal.tp1','signal.tp2','signal.tp3','signal.break_even','signal.stop_hit') then n.targets
  when o.event_type in ('news.upcoming','news.released') then n.news
  when o.event_type='announcement.published' then n.announcements else false end);
$$;
create or replace function public.claim_push_deliveries(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.notification_deliveries;result jsonb='[]';token uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_deliveries where (state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<now()) order by next_attempt_at for update skip locked limit least(greatest(batch_size,1),100) loop
  if item.attempts>=5 then update public.notification_deliveries set state='failed',error_code='attempts_exhausted' where id=item.id;continue;end if;
  if not public.notification_allowed(item.outbox_id,item.subscription_id) then update public.notification_deliveries set state='skipped',error_code='no_longer_eligible' where id=item.id;continue;end if;
  token=gen_random_uuid();
  update public.notification_deliveries set state='processing',attempts=attempts+1,lease_token=token,lease_until=now()+interval '2 minutes' where id=item.id;
  result=result||(select jsonb_build_array(jsonb_build_object('id',item.id,'outbox_id',item.outbox_id,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,'lease_token',token,'attempts',item.attempts+1,'event_type',o.event_type,'signal_id',o.signal_id,'calendar_event_id',o.calendar_event_id)) from public.push_subscriptions s,public.notification_outbox o where s.id=item.subscription_id and o.id=item.outbox_id);
 end loop;return result;
end;
$$;
create or replace function public.audit_signal_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.observation_quote_id is not null or new.observation_entry is not null or new.observation_started_at is not null or new.last_quote_id is not null or new.stop_observed_at is not null or new.reconciliation_state<>'not_started' or new.status<>'draft' or new.approved_by is not null or new.published_at is not null or new.closed_at is not null or new.tp1_hit_at is not null or new.tp2_hit_at is not null or new.tp3_hit_at is not null or new.outcome is not null or new.pricing_source is not null or new.max_favorable_movement is not null or new.break_even then raise exception 'Signals must start as unapproved drafts without outcomes';end if;
 new.created_at=now();new.updated_at=now();new.version=1;
 if auth.role()='service_role' and new.source='tradingview' and new.created_by is null and new.source_event_id is not null and new.source_fingerprint is not null then
  insert into public.audit_logs(actor_id,action,entity_id) values(null,'signal.ingested',new.id);
 else
  if not public.is_admin() or new.source<>'manual' or new.created_by is distinct from auth.uid() or new.source_event_id is not null or new.source_fingerprint is not null or new.source_timestamp is not null then raise exception 'Administrator manual draft required';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('signal-create:'||auth.uid()::text));
  if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='signal.created' and created_at>now()-interval '1 minute')>=20 then raise exception 'Signal creation rate limit exceeded';end if;
  insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'signal.created',new.id);
 end if;return new;
end;
$$;
revoke all on function public.provider_display_allowed(uuid),public.start_signal_observation(uuid,uuid),public.reconcile_market_quote(uuid),public.ingest_market_quote(jsonb),public.ingest_calendar_event(jsonb),public.queue_upcoming_calendar_events(),public.get_market_snapshot(),public.protect_observed_levels() from public,anon,authenticated;
grant execute on function public.provider_display_allowed(uuid),public.start_signal_observation(uuid,uuid),public.get_market_snapshot() to authenticated;
grant execute on function public.reconcile_market_quote(uuid),public.ingest_market_quote(jsonb),public.ingest_calendar_event(jsonb),public.queue_upcoming_calendar_events() to service_role;
commit;
