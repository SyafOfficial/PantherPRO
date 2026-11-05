begin;
create table public.client_access_policy(singleton boolean primary key default true check(singleton),enforced boolean not null default false,updated_at timestamptz not null default now());
insert into public.client_access_policy(singleton) values(true);
create table public.client_applications(
 user_id uuid primary key references public.profiles(id),revision uuid not null default gen_random_uuid(),
 full_name text not null check(length(full_name) between 2 and 120),email text not null,phone text not null,client_id text not null,
 mt5_login text not null check(mt5_login ~ '^[1-9][0-9]{3,19}$'),server text not null check(server ~* '^vestrado[a-z0-9 ._-]{0,90}$'),
 status text not null default 'pending' check(status in ('pending','approved','revoked')),
 reason text not null default 'verification_pending',submitted_at timestamptz not null default now(),approved_at timestamptz,revoked_at timestamptz,
 funded_at timestamptz,last_trade_at timestamptz,last_checked_at timestamptz,balance numeric,equity numeric,credit numeric,deposits numeric,withdrawals numeric,
 consent_at timestamptz not null default now(),consent_version text not null default '2026-11-v1'
);
create unique index client_broker_account_unique on public.client_applications(lower(server),mt5_login);
create table public.client_credentials(user_id uuid primary key references public.client_applications(user_id) on delete cascade,ciphertext text not null);
create table public.client_access_events(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.client_applications(user_id),kind text not null,reason text not null,created_at timestamptz not null default now());
create index client_events_recent on public.client_access_events(created_at desc,id);
create index client_checks_due on public.client_applications(last_checked_at nulls first,user_id);
alter table public.client_access_policy enable row level security;
alter table public.client_applications enable row level security;
alter table public.client_credentials enable row level security;
alter table public.client_access_events enable row level security;
revoke all on public.client_access_policy,public.client_applications,public.client_credentials,public.client_access_events from public,anon,authenticated;
grant select on public.client_access_policy,public.client_applications,public.client_access_events to authenticated;
grant all on public.client_access_policy,public.client_applications,public.client_credentials,public.client_access_events to service_role;
create policy client_policy_read on public.client_access_policy for select to authenticated using(true);
create policy client_application_read on public.client_applications for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create policy client_event_admin on public.client_access_events for select to authenticated using((select public.is_admin()));
-- Credentials have no browser grants or policies; only server-side service calls.
create function public.client_access_allowed_for(owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=owner and (p.role='admin' or not (select enforced from public.client_access_policy where singleton) or exists(select 1 from public.client_applications a where a.user_id=owner and a.status='approved')));
$$;
revoke all on function public.client_access_allowed_for(uuid) from public,anon,authenticated;
create function public.client_access_allowed() returns boolean language sql stable security definer set search_path='' as $$select public.client_access_allowed_for(auth.uid())$$;
revoke all on function public.client_access_allowed() from public,anon;
grant execute on function public.client_access_allowed() to authenticated;
create policy client_signals_gate on public.signals as restrictive for select to authenticated using((select public.client_access_allowed()));
create policy client_announcements_gate on public.announcements as restrictive for select to authenticated using((select public.client_access_allowed()));
create function public.submit_client_application(owner uuid,details jsonb,encrypted text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if length(encrypted)<20 or length(encrypted)>1000 then raise exception 'Invalid credential';end if;
 insert into public.client_applications(user_id,full_name,email,phone,client_id,mt5_login,server)
 values(owner,details->>'full_name',details->>'email',details->>'phone',details->>'client_id',details->>'mt5_login',details->>'server');
 insert into public.client_credentials values(owner,encrypted);
 insert into public.client_access_events(user_id,kind,reason) values(owner,'submitted','verification_pending');
end;$$;
create function public.record_client_assessment(owner uuid,expected_revision uuid,observed timestamptz,result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare a public.client_applications;new_status text=result->>'status';
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into a from public.client_applications where user_id=owner for update;
 if not found or a.revision<>expected_revision or observed<=coalesce(a.last_checked_at,'-infinity'::timestamptz) then return false;end if;
 if observed<now()-interval '5 minutes' or observed>now()+interval '5 seconds' or new_status not in ('pending','approved','revoked') or (a.status='revoked' and new_status<>'revoked') then raise exception 'Invalid assessment';end if;
 update public.client_applications set status=new_status,reason=result->>'reason',last_checked_at=observed,
 approved_at=case when new_status='approved' then coalesce(approved_at,now()) else approved_at end,
 revoked_at=case when new_status='revoked' then coalesce(revoked_at,now()) else revoked_at end,
 funded_at=(result->>'funded_at')::timestamptz,last_trade_at=coalesce((result->>'last_trade_at')::timestamptz,last_trade_at),
 balance=(result->>'balance')::numeric,equity=(result->>'equity')::numeric,credit=(result->>'credit')::numeric,
 deposits=(result->>'deposits')::numeric,withdrawals=(result->>'withdrawals')::numeric where user_id=owner;
 if a.status<>new_status then
  insert into public.client_access_events(user_id,kind,reason) values(owner,new_status,result->>'reason');
  insert into public.notification_outbox(event_key,event_type,access,recipient_id)
   select owner::text||':client:'||new_status||':'||a.revision::text||':'||p.id::text,'client.'||new_status,'public',p.id from public.profiles p where role='admin' on conflict(event_key) do nothing;
 end if;
 return true;
end;$$;
create function public.set_client_gate(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'MFA administrator required';end if;
 if enabled and not exists(select 1 from public.client_applications where last_checked_at>now()-interval '10 minutes' and status='approved') then raise exception 'Verify a live client account before enforcing access';end if;
 update public.client_access_policy set enforced=enabled,updated_at=now() where singleton;
 insert into public.audit_logs(actor_id,action,details) values(auth.uid(),'client.gate_changed',jsonb_build_object('enabled',enabled));
end;$$;
revoke all on function public.submit_client_application(uuid,jsonb,text),public.record_client_assessment(uuid,uuid,timestamptz,jsonb),public.set_client_gate(boolean) from public,anon,authenticated;
grant execute on function public.submit_client_application(uuid,jsonb,text),public.record_client_assessment(uuid,uuid,timestamptz,jsonb) to service_role;
grant execute on function public.set_client_gate(boolean) to authenticated;
-- Preserve all existing push permissions and apply client eligibility again at delivery.
alter function public.notification_allowed(uuid,uuid) rename to notification_allowed_before_client_gate;
revoke all on function public.notification_allowed_before_client_gate(uuid,uuid) from public,anon,authenticated,service_role;
create function public.notification_allowed(event_id uuid,device_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare owner uuid;event public.notification_outbox;
begin
 select user_id into owner from public.push_subscriptions where id=device_id and active;
 if owner is null or not public.client_access_allowed_for(owner) then return false;end if;
 select * into event from public.notification_outbox where id=event_id;
 if event.event_type in ('client.approved','client.revoked') then
  return event.recipient_id=owner and event.created_at>now()-interval '24 hours'
   and exists(select 1 from public.profiles where id=owner and role='admin')
   and exists(select 1 from public.notification_preferences where user_id=owner and push_enabled);
 end if;
 return public.notification_allowed_before_client_gate(event_id,device_id);
end;$$;
revoke all on function public.notification_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.notification_allowed(uuid,uuid) to service_role;
alter function public.get_market_snapshot() rename to get_market_snapshot_before_client_gate;
revoke all on function public.get_market_snapshot_before_client_gate() from public,anon,authenticated,service_role;
create function public.get_market_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if not public.client_access_allowed() then raise exception 'Membership verification required';end if;
 return public.get_market_snapshot_before_client_gate();
end;$$;
revoke all on function public.get_market_snapshot() from public,anon;
grant execute on function public.get_market_snapshot() to authenticated;
alter function public.get_intelligence_inputs() rename to get_intelligence_inputs_before_client_gate;
revoke all on function public.get_intelligence_inputs_before_client_gate() from public,anon,authenticated,service_role;
create function public.get_intelligence_inputs() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if not public.client_access_allowed() then raise exception 'Membership verification required';end if;
 return public.get_intelligence_inputs_before_client_gate();
end;$$;
revoke all on function public.get_intelligence_inputs() from public,anon;
grant execute on function public.get_intelligence_inputs() to authenticated;
alter function public.get_member_signal_summary() rename to get_member_signal_summary_before_client_gate;
revoke all on function public.get_member_signal_summary_before_client_gate() from public,anon,authenticated,service_role;
create function public.get_member_signal_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if not public.client_access_allowed() then raise exception 'Membership verification required';end if;
 return public.get_member_signal_summary_before_client_gate();
end;$$;
revoke all on function public.get_member_signal_summary() from public,anon;
grant execute on function public.get_member_signal_summary() to authenticated;
commit;
