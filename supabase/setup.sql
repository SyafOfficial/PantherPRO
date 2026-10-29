-- PantherPRO initial setup: dedicated new project only; apply once.
BEGIN;
-- Phase 1: apply with the Supabase SQL editor or Supabase CLI migrations.

create type public.member_role as enum ('public','vip','admin');
create type public.signal_status as enum ('draft','pending','active','closed');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'Member' check(length(display_name)<=60),
 role public.member_role not null default 'public',
 created_at timestamptz not null default now()
);
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
create function public.has_vip() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('vip','admin'));
$$;
create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
 begin insert into public.profiles(id,display_name) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Member'),60));return new;end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
create table public.signals (
 id uuid primary key default gen_random_uuid(),
 instrument text not null default 'XAUUSD' check(instrument='XAUUSD'),
 direction text not null check(direction in ('BUY','SELL')),
 entry numeric(14,4) not null check(entry>0),stop_loss numeric(14,4) not null check(stop_loss>0),
 tp1 numeric(14,4) not null check(tp1>0),tp2 numeric(14,4) not null check(tp2>0),tp3 numeric(14,4) not null check(tp3>0),
 reasoning text not null check(length(trim(reasoning)) between 20 and 2000),
 access text not null default 'public' check(access in ('public','vip')),
 status public.signal_status not null default 'draft',source text not null default 'manual' check(source in ('manual','tradingview','mt5')),
 source_event_id text,created_by uuid references public.profiles(id) default auth.uid(),
 approved_by uuid references public.profiles(id),published_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),closed_at timestamptz,
 tp1_hit_at timestamptz,tp2_hit_at timestamptz,tp3_hit_at timestamptz,break_even boolean not null default false,
 max_favorable_movement numeric check(max_favorable_movement>=0),
 outcome text check(outcome in ('win','loss','break_even')),pricing_source text,
 unique(source,source_event_id),
 check((direction='BUY' and stop_loss<entry and entry<tp1 and tp1<tp2 and tp2<tp3) or (direction='SELL' and stop_loss>entry and entry>tp1 and tp1>tp2 and tp2>tp3)),
 check(status not in ('active','closed') or (approved_by is not null and published_at is not null) or (status='closed' and published_at is null))
);
create index signals_status_created_idx on public.signals(status,created_at desc);
create table public.audit_logs (
 id bigint generated always as identity primary key,actor_id uuid,action text not null,
 entity_id uuid,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 signals boolean not null default true,targets boolean not null default true,news boolean not null default false,
 announcements boolean not null default true,updated_at timestamptz not null default now()
);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(endpoint like 'https://%'),p256dh text not null,auth text not null,created_at timestamptz not null default now()
);
create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(),event_key text not null unique,
 signal_id uuid references public.signals(id),event_type text not null,access text not null check(access in ('public','vip')),
 payload jsonb not null default '{}',attempts integer not null default 0,
 state text not null default 'pending' check(state in ('pending','processing','delivered','failed')),
 next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now()
);
create table public.notification_deliveries (
 id uuid primary key default gen_random_uuid(),outbox_id uuid not null references public.notification_outbox(id),
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 state text not null check(state in ('pending','delivered','failed')),attempts integer not null default 0,
 delivered_at timestamptz,error_code text,unique(outbox_id,subscription_id)
);
create table public.announcements (
 id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 150),
 body text not null check(length(body) between 1 and 5000),access text not null default 'public' check(access in ('public','vip')),
 published_at timestamptz,created_at timestamptz not null default now()
);
create table public.membership_entitlements (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 provider text,external_reference text,starts_at timestamptz,ends_at timestamptz,
 state text not null default 'inactive' check(state in ('inactive','active','expired')),
 created_at timestamptz not null default now()
);
-- Schema only. No payment provider, automated trading, feed or worker is activated.
create function public.audit_signal_insert() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if new.status<>'draft' or new.source<>'manual' or new.approved_by is not null or new.published_at is not null or new.closed_at is not null or new.tp1_hit_at is not null or new.tp2_hit_at is not null or new.tp3_hit_at is not null or new.outcome is not null or new.pricing_source is not null or new.max_favorable_movement is not null or new.break_even or new.created_by is distinct from auth.uid() then raise exception 'Manual signals must start as unapproved drafts without outcomes';end if;
 if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='signal.created' and created_at>now()-interval '1 minute')>=20 then raise exception 'Signal creation rate limit exceeded';end if;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'signal.created',new.id);return new;end;
$$;
create trigger signal_insert_audit before insert on public.signals for each row execute function public.audit_signal_insert();
create function public.transition_signal(signal_id uuid,next_status text) returns void language plpgsql security definer set search_path='' as $$
 declare current_signal public.signals;
 begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 select * into current_signal from public.signals where id=signal_id for update;
 if not found then raise exception 'Signal not found';end if;
 if not ((current_signal.status='draft' and next_status='pending') or (current_signal.status='pending' and next_status in ('active','closed')) or (current_signal.status='active' and next_status='closed')) then raise exception 'Invalid lifecycle transition';end if;
 update public.signals set status=next_status::public.signal_status,updated_at=now(),approved_by=case when next_status='active' then auth.uid() else approved_by end,published_at=case when next_status='active' then now() else published_at end,closed_at=case when next_status='closed' then now() else null end where id=signal_id;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'signal.'||next_status,signal_id,jsonb_build_object('previous_status',current_signal.status));
 if next_status='active' or (next_status='closed' and current_signal.published_at is not null) then
 insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(signal_id::text||':'||next_status,signal_id,'signal.'||next_status,current_signal.access,jsonb_build_object('signal_id',signal_id)) on conflict(event_key) do nothing;
 end if;
 end;
$$;
create function public.set_member_role(member_id uuid,new_role text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 if new_role not in ('public','vip') then raise exception 'Only public and VIP roles can be managed here';end if;
 perform 1 from public.profiles where id=member_id and role<>'admin' for update;
 if not found then raise exception 'Member not found or protected';end if;
 update public.profiles set role=new_role::public.member_role where id=member_id;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'member.role_changed',member_id,jsonb_build_object('role',new_role));end;
$$;
alter table public.profiles enable row level security;
alter table public.signals enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.announcements enable row level security;
alter table public.membership_entitlements enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profiles_edit_name on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy signals_read on public.signals for select to authenticated using(public.is_admin() or (status in ('pending','active','closed') and published_at is not null and (access='public' or public.has_vip())));
create policy signals_create on public.signals for insert to authenticated with check(public.is_admin() and status='draft');
create policy audit_admin on public.audit_logs for select to authenticated using(public.is_admin());
create policy preferences_own on public.notification_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy subscriptions_own on public.push_subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy outbox_admin_read on public.notification_outbox for select to authenticated using(public.is_admin());
create policy deliveries_admin_read on public.notification_deliveries for select to authenticated using(public.is_admin());
create policy announcements_read on public.announcements for select to authenticated using(public.is_admin() or (published_at<=now() and (access='public' or public.has_vip())));
create policy entitlements_read on public.membership_entitlements for select to authenticated using(user_id=auth.uid() or public.is_admin());
-- Explicit privileges: no direct role updates, lifecycle updates or client queue writes.
revoke all on public.profiles,public.signals,public.audit_logs,public.notification_preferences,public.push_subscriptions,public.notification_outbox,public.notification_deliveries,public.announcements,public.membership_entitlements from anon,authenticated;
grant select on public.profiles,public.signals,public.audit_logs,public.notification_outbox,public.notification_deliveries,public.announcements,public.membership_entitlements to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant insert on public.signals to authenticated;
grant select,insert,update,delete on public.notification_preferences,public.push_subscriptions to authenticated;
revoke all on function public.is_admin(),public.has_vip(),public.create_profile(),public.audit_signal_insert(),public.transition_signal(uuid,text),public.set_member_role(uuid,text) from public,anon;
grant execute on function public.is_admin(),public.has_vip(),public.transition_signal(uuid,text),public.set_member_role(uuid,text) to authenticated;
-- Realtime delivers only records authorized by the SELECT policy. Never publish outbox or audit tables.
alter publication supabase_realtime add table public.signals;


alter table public.signals add column version integer not null default 1;
alter table public.signals add column source_fingerprint text;
alter table public.signals add column source_timestamp timestamptz;
create or replace function public.audit_signal_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'draft' or new.approved_by is not null or new.published_at is not null or new.closed_at is not null or new.tp1_hit_at is not null or new.tp2_hit_at is not null or new.tp3_hit_at is not null or new.outcome is not null or new.pricing_source is not null or new.max_favorable_movement is not null or new.break_even then raise exception 'Signals must start as unapproved drafts without outcomes';end if;
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
create function public.ingest_tradingview(alert jsonb,fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.signals;new_id uuid;alert_time timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if fingerprint !~ '^[a-f0-9]{64}$' or alert->>'event_id' !~ '^[A-Za-z0-9._:-]{8,128}$' then raise exception 'Invalid event';end if;
 alert_time=(alert->>'timestamp')::timestamptz;
 if alert_time is null or abs(extract(epoch from (now()-alert_time)))>300 then raise exception 'Stale alert';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tradingview-ingest'));
 select * into existing from public.signals where source='tradingview' and source_event_id=alert->>'event_id';
 if found then
  if existing.source_fingerprint is distinct from fingerprint then raise exception using errcode='P0409',message='Conflicting event';end if;
  return jsonb_build_object('id',existing.id,'duplicate',true,'status',existing.status);
 end if;
 if (select count(*) from public.audit_logs where action='signal.ingested' and created_at>now()-interval '1 minute')>=60 then raise exception using errcode='P0429',message='Ingestion rate exceeded';end if;
 insert into public.signals(instrument,direction,entry,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by)
 values(alert->>'instrument',alert->>'direction',(alert->>'entry')::numeric,(alert->>'stop_loss')::numeric,(alert->>'tp1')::numeric,(alert->>'tp2')::numeric,(alert->>'tp3')::numeric,alert->>'reasoning',alert->>'access','tradingview',alert->>'event_id',fingerprint,alert_time,null) returning id into new_id;
 update public.signals set status='pending' where id=new_id;
 return jsonb_build_object('id',new_id,'duplicate',false,'status','pending');
end;
$$;
create function public.revise_signal(signal_id uuid,expected_version integer,changes jsonb,revision_reason text) returns void language plpgsql security definer set search_path='' as $$
declare old_signal public.signals;new_signal public.signals;event_name text;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 if length(trim(revision_reason)) not between 10 and 500 then raise exception 'Revision reason required';end if;
 select * into old_signal from public.signals where id=signal_id for update;
 if not found or old_signal.status='closed' then raise exception 'Editable signal not found';end if;
 if old_signal.version is distinct from expected_version then raise exception 'Stale revision; reload before editing';end if;
 if old_signal.status='active' and ((changes->>'entry')::numeric is distinct from old_signal.entry or changes->>'direction' is distinct from old_signal.direction or changes->>'access' is distinct from old_signal.access) then raise exception 'Published entry, direction and access cannot change';end if;
 update public.signals set direction=changes->>'direction',entry=(changes->>'entry')::numeric,stop_loss=(changes->>'stop_loss')::numeric,tp1=(changes->>'tp1')::numeric,tp2=(changes->>'tp2')::numeric,tp3=(changes->>'tp3')::numeric,reasoning=changes->>'reasoning',access=changes->>'access',version=version+1,updated_at=now() where id=signal_id returning * into new_signal;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'signal.revised',signal_id,jsonb_build_object('reason',revision_reason,'before',to_jsonb(old_signal),'after',to_jsonb(new_signal)));
 if old_signal.status='active' then
  event_name=case when old_signal.stop_loss<>new_signal.stop_loss then 'signal.stop_loss' else 'signal.modified' end;
  insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(signal_id::text||':revision:'||new_signal.version,signal_id,event_name,new_signal.access,jsonb_build_object('signal_id',signal_id,'version',new_signal.version));
 end if;
end;
$$;
-- A transition increments version so an open edit form cannot overwrite a newer lifecycle state.
create function public.bump_signal_transition_version() returns trigger language plpgsql set search_path='' as $$
begin if new.status is distinct from old.status then new.version=old.version+1;end if;return new;end;
$$;
create trigger signal_transition_version before update on public.signals for each row execute function public.bump_signal_transition_version();
create function public.publish_announcement(heading text,content text,audience text) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('announcement:'||auth.uid()::text));
 if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='announcement.published' and created_at>now()-interval '1 minute')>=10 then raise exception 'Announcement rate exceeded';end if;
 insert into public.announcements(title,body,access,published_at) values(heading,content,audience,now()) returning id into new_id;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'announcement.published',new_id);
 insert into public.notification_outbox(event_key,event_type,access,payload) values('announcement:'||new_id,'announcement.published',audience,jsonb_build_object('announcement_id',new_id));
 return new_id;
end;
$$;
revoke all on function public.ingest_tradingview(jsonb,text),public.revise_signal(uuid,integer,jsonb,text),public.bump_signal_transition_version(),public.publish_announcement(text,text,text) from public,anon,authenticated;
grant execute on function public.ingest_tradingview(jsonb,text) to service_role;
grant execute on function public.revise_signal(uuid,integer,jsonb,text),public.publish_announcement(text,text,text) to authenticated;


alter table public.notification_preferences add column push_enabled boolean not null default false;
alter table public.notification_outbox add column prepared_at timestamptz;
alter table public.notification_outbox add column recipient_id uuid references public.profiles(id) on delete cascade;
alter table public.notification_deliveries drop constraint notification_deliveries_state_check;
alter table public.notification_deliveries add constraint notification_deliveries_state_check check(state in ('pending','processing','delivered','failed','skipped'));
alter table public.notification_deliveries add column next_attempt_at timestamptz not null default now();
alter table public.notification_deliveries add column lease_until timestamptz;
alter table public.notification_deliveries add column lease_token uuid;
create index push_delivery_ready_idx on public.notification_deliveries(state,next_attempt_at);
-- Expired subscriptions are retained as inactive to preserve delivery logs.
alter table public.push_subscriptions add column active boolean not null default true;
revoke insert,update,delete on public.push_subscriptions from authenticated;
create function public.register_push_subscription(subscription jsonb) returns void language plpgsql security definer set search_path='' as $$
declare endpoint_value text;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 endpoint_value=subscription->>'endpoint';
 if endpoint_value !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^[:space:]]+$' or length(endpoint_value)>2048 or (subscription->'keys'->>'p256dh') !~ '^[A-Za-z0-9_-]{87}$' or (subscription->'keys'->>'auth') !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Unsupported subscription';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('push-register:'||auth.uid()::text));
 if (select count(*) from public.push_subscriptions where user_id=auth.uid() and active)>=10 and not exists(select 1 from public.push_subscriptions where endpoint=endpoint_value and user_id=auth.uid() and active) then raise exception 'Device limit reached';end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values(auth.uid(),endpoint_value,subscription->'keys'->>'p256dh',subscription->'keys'->>'auth')
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,active=true where public.push_subscriptions.user_id=auth.uid();
 if not found then raise exception 'Subscription unavailable';end if;
 insert into public.notification_preferences(user_id,push_enabled) values(auth.uid(),true) on conflict(user_id) do update set push_enabled=true,updated_at=now();
end;
$$;
create function public.remove_push_subscription(subscription_endpoint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 update public.push_subscriptions set active=false where endpoint=subscription_endpoint and user_id=auth.uid();
 if not exists(select 1 from public.push_subscriptions where user_id=auth.uid() and active) then update public.notification_preferences set push_enabled=false,updated_at=now() where user_id=auth.uid();end if;
end;
$$;
create function public.notification_allowed(event_id uuid,device_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notification_outbox o
 join public.push_subscriptions s on s.id=device_id and s.active
 join public.profiles p on p.id=s.user_id
 join public.notification_preferences n on n.user_id=p.id and n.push_enabled
 where o.id=event_id and o.created_at>now()-interval '24 hours'
 and (o.recipient_id is null or o.recipient_id=p.id)
 and (o.access='public' or p.role in ('vip','admin'))
 and (o.signal_id is null or exists(select 1 from public.signals x where x.id=o.signal_id and x.published_at is not null and (x.access='public' or p.role in ('vip','admin'))))
 and case when o.event_type='push.test' then o.recipient_id=p.id
  when o.event_type in ('signal.active','signal.modified','signal.closed') then n.signals
  when o.event_type in ('signal.stop_loss','signal.tp1','signal.tp2','signal.tp3','signal.break_even') then n.targets
  when o.event_type in ('news.upcoming','news.released') then n.news
  when o.event_type='announcement.published' then n.announcements else false end);
$$;
create function public.enqueue_test_notification() returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('push-test:'||auth.uid()::text));
 if exists(select 1 from public.notification_outbox where recipient_id=auth.uid() and event_type='push.test' and created_at>now()-interval '1 minute') then raise exception 'Test rate exceeded';end if;
 if not exists(select 1 from public.notification_preferences where user_id=auth.uid() and push_enabled) or not exists(select 1 from public.push_subscriptions where user_id=auth.uid() and active) then raise exception 'Enable push first';end if;
 new_id=gen_random_uuid();
 insert into public.notification_outbox(id,event_key,event_type,access,recipient_id) values(new_id,'test:'||new_id,'push.test','public',auth.uid());
 return new_id;
end;
$$;
create function public.prepare_push_deliveries(batch_size integer default 20) returns integer language plpgsql security definer set search_path='' as $$
declare item public.notification_outbox;total integer=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_outbox where prepared_at is null and state='pending' order by created_at for update skip locked limit least(greatest(batch_size,1),100) loop
  insert into public.notification_deliveries(outbox_id,subscription_id,state)
  select item.id,s.id,'pending' from public.push_subscriptions s where public.notification_allowed(item.id,s.id) on conflict(outbox_id,subscription_id) do nothing;
  update public.notification_outbox set prepared_at=now(),state=case when exists(select 1 from public.notification_deliveries where outbox_id=item.id) then 'processing' else 'delivered' end where id=item.id;
  total=total+1;
 end loop;return total;
end;
$$;
create function public.claim_push_deliveries(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.notification_deliveries;result jsonb='[]';token uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_deliveries where (state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<now()) order by next_attempt_at for update skip locked limit least(greatest(batch_size,1),100) loop
  if item.attempts>=5 then update public.notification_deliveries set state='failed',error_code='attempts_exhausted' where id=item.id;continue;end if;
  if not public.notification_allowed(item.outbox_id,item.subscription_id) then update public.notification_deliveries set state='skipped',error_code='no_longer_eligible' where id=item.id;continue;end if;
  token=gen_random_uuid();
  update public.notification_deliveries set state='processing',attempts=attempts+1,lease_token=token,lease_until=now()+interval '2 minutes' where id=item.id;
  result=result||(select jsonb_build_array(jsonb_build_object('id',item.id,'outbox_id',item.outbox_id,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,'lease_token',token,'attempts',item.attempts+1,'event_type',o.event_type,'signal_id',o.signal_id)) from public.push_subscriptions s,public.notification_outbox o where s.id=item.subscription_id and o.id=item.outbox_id);
 end loop;return result;
end;
$$;
create function public.finish_push_delivery(delivery_id uuid,claim_token uuid,result_state text,failure_code text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare item public.notification_deliveries;new_state text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if result_state not in ('delivered','retry','failed','expired','skipped') then raise exception 'Invalid result';end if;
 select * into item from public.notification_deliveries where id=delivery_id and state='processing' and lease_token=claim_token and lease_until>now() for update;
 if not found then return false;end if;
 new_state=case when result_state='retry' and item.attempts<5 then 'pending' when result_state in ('retry','expired') then 'failed' else result_state end;
 update public.notification_deliveries set state=new_state,error_code=left(failure_code,80),delivered_at=case when new_state='delivered' then now() else null end,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,item.attempts-1)::integer)),lease_until=null,lease_token=null where id=delivery_id;
 if result_state='expired' then update public.push_subscriptions set active=false where id=item.subscription_id;end if;
 return true;
end;
$$;
create function public.finalize_push_events() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 update public.notification_outbox o set state=case when exists(select 1 from public.notification_deliveries d where d.outbox_id=o.id and d.state='failed') then 'failed' else 'delivered' end
 where o.prepared_at is not null and o.state='processing' and not exists(select 1 from public.notification_deliveries d where d.outbox_id=o.id and d.state in ('pending','processing'));
end;
$$;
revoke all on function public.register_push_subscription(jsonb),public.remove_push_subscription(text),public.enqueue_test_notification(),public.notification_allowed(uuid,uuid),public.prepare_push_deliveries(integer),public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,text),public.finalize_push_events() from public,anon,authenticated;
grant execute on function public.register_push_subscription(jsonb),public.remove_push_subscription(text),public.enqueue_test_notification() to authenticated;
grant execute on function public.notification_allowed(uuid,uuid),public.prepare_push_deliveries(integer),public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,text),public.finalize_push_events() to service_role;


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


-- Analysis rights must be explicitly reviewed separately from display rights.
alter table public.data_providers add column analysis_allowed boolean not null default false;
create function public.get_intelligence_inputs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare quote_source uuid;quotes jsonb;events jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select p.id into quote_source from public.data_providers p join public.market_quotes q on q.provider_id=p.id where p.kind='quotes' and p.enabled and p.display_allowed and p.analysis_allowed order by q.observed_at desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('max_gap_seconds',p.max_gap_seconds) order by q.observed_at),'[]'::jsonb) into quotes from (select * from public.market_quotes where provider_id=quote_source and observed_at>=now()-interval '90 minutes' order by observed_at desc limit 2400) q join public.data_providers p on p.id=q.provider_id;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.event_time),'[]'::jsonb) into events from (select e.* from public.calendar_events e join public.data_providers p on p.id=e.provider_id and p.enabled and p.display_allowed and p.analysis_allowed where e.event_time between now()-interval '24 hours' and now()+interval '24 hours' order by e.event_time limit 100) e;
 return jsonb_build_object('quotes',quotes,'events',events,'as_of',now());
end;
$$;
revoke all on function public.get_intelligence_inputs() from public,anon,authenticated;
grant execute on function public.get_intelligence_inputs() to authenticated;


alter table public.signals add column strategy text check(strategy in ('QM','QMTR','BOS','CHOCH','TRENDLINE'));
alter table public.signals add column timeframe text check(timeframe in ('M30','H1','H4','D1','W1'));
alter table public.signals add column higher_timeframe text check(higher_timeframe in ('M30','H1','H4','D1','W1'));
create function public.timeframe_minutes(value text) returns integer language sql immutable set search_path='' as $$
 select case value when 'M30' then 30 when 'H1' then 60 when 'H4' then 240 when 'D1' then 1440 when 'W1' then 10080 else null end;
$$;
alter table public.signals add constraint valid_signal_method check((strategy is null and timeframe is null and higher_timeframe is null) or (strategy is not null and timeframe is not null and (higher_timeframe is null or public.timeframe_minutes(higher_timeframe)>public.timeframe_minutes(timeframe))));
create function public.protect_signal_method() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('active','closed') and (new.strategy is distinct from old.strategy or new.timeframe is distinct from old.timeframe or new.higher_timeframe is distinct from old.higher_timeframe) then raise exception 'Published strategy and timeframe tags are immutable';end if;
 return new;
end;
$$;
create trigger protect_signal_method before update on public.signals for each row execute function public.protect_signal_method();
revoke all on function public.protect_signal_method() from public,anon,authenticated;

create or replace function public.ingest_tradingview(alert jsonb,fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.signals;new_id uuid;alert_time timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if fingerprint !~ '^[a-f0-9]{64}$' or alert->>'event_id' !~ '^[A-Za-z0-9._:-]{8,128}$' then raise exception 'Invalid event';end if;
 alert_time=(alert->>'timestamp')::timestamptz;
 if alert_time is null or abs(extract(epoch from (now()-alert_time)))>300 then raise exception 'Stale alert';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tradingview-ingest'));
 select * into existing from public.signals where source='tradingview' and source_event_id=alert->>'event_id';
 if found then
  if existing.source_fingerprint is distinct from fingerprint then raise exception using errcode='P0409',message='Conflicting event';end if;
  return jsonb_build_object('id',existing.id,'duplicate',true,'status',existing.status);
 end if;
 if (select count(*) from public.audit_logs where action='signal.ingested' and created_at>now()-interval '1 minute')>=60 then raise exception using errcode='P0429',message='Ingestion rate exceeded';end if;
 insert into public.signals(instrument,direction,entry,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,higher_timeframe)
 values(alert->>'instrument',alert->>'direction',(alert->>'entry')::numeric,(alert->>'stop_loss')::numeric,(alert->>'tp1')::numeric,(alert->>'tp2')::numeric,(alert->>'tp3')::numeric,alert->>'reasoning',alert->>'access','tradingview',alert->>'event_id',fingerprint,alert_time,null,alert->>'strategy',alert->>'timeframe',alert->>'higher_timeframe') returning id into new_id;
 update public.signals set status='pending' where id=new_id;
 return jsonb_build_object('id',new_id,'duplicate',false,'status','pending');
end;
$$;
create or replace function public.revise_signal(signal_id uuid,expected_version integer,changes jsonb,revision_reason text) returns void language plpgsql security definer set search_path='' as $$
declare old_signal public.signals;new_signal public.signals;event_name text;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 if length(trim(revision_reason)) not between 10 and 500 then raise exception 'Revision reason required';end if;
 select * into old_signal from public.signals where id=signal_id for update;
 if not found or old_signal.status='closed' then raise exception 'Editable signal not found';end if;
 if old_signal.version is distinct from expected_version then raise exception 'Stale revision; reload before editing';end if;
 if old_signal.status='active' and ((changes->>'entry')::numeric is distinct from old_signal.entry or changes->>'direction' is distinct from old_signal.direction or changes->>'access' is distinct from old_signal.access) then raise exception 'Published entry, direction and access cannot change';end if;
 update public.signals set strategy=case when changes?'strategy' then changes->>'strategy' else strategy end,timeframe=case when changes?'timeframe' then changes->>'timeframe' else timeframe end,higher_timeframe=case when changes?'higher_timeframe' then changes->>'higher_timeframe' else higher_timeframe end,direction=changes->>'direction',entry=(changes->>'entry')::numeric,stop_loss=(changes->>'stop_loss')::numeric,tp1=(changes->>'tp1')::numeric,tp2=(changes->>'tp2')::numeric,tp3=(changes->>'tp3')::numeric,reasoning=changes->>'reasoning',access=changes->>'access',version=version+1,updated_at=now() where id=signal_id returning * into new_signal;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'signal.revised',signal_id,jsonb_build_object('reason',revision_reason,'before',to_jsonb(old_signal),'after',to_jsonb(new_signal)));
 if old_signal.status='active' then
  event_name=case when old_signal.stop_loss<>new_signal.stop_loss then 'signal.stop_loss' else 'signal.modified' end;
  insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(signal_id::text||':revision:'||new_signal.version,signal_id,event_name,new_signal.access,jsonb_build_object('signal_id',signal_id,'version',new_signal.version));
 end if;
end;
$$;


-- Preserve old rows and migration history; reject creation or reassignment to QMTR.
create function public.reject_retired_strategy() returns trigger language plpgsql set search_path='' as $$
begin
 if new.strategy='QMTR' then
  if tg_op='INSERT' then raise exception 'QMTR is retired';end if;
  if old.strategy is distinct from new.strategy then raise exception 'QMTR is retired';end if;
 end if;
 return new;
end;
$$;
create trigger reject_retired_strategy before insert or update on public.signals for each row execute function public.reject_retired_strategy();
revoke all on function public.reject_retired_strategy() from public,anon,authenticated;


create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal','aal1')='aal2' and exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
create function public.deployment_readiness() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform id,strategy,timeframe from public.signals limit 0;
 perform id,role from public.profiles limit 0;
 perform user_id,push_enabled from public.notification_preferences limit 0;
 perform id,analysis_allowed from public.data_providers limit 0;
 return jsonb_build_object('schema_version',8,'admin_mfa_required',true);
end;
$$;
revoke all on function public.deployment_readiness() from public,anon,authenticated;
grant execute on function public.deployment_readiness() to service_role;

COMMIT;
