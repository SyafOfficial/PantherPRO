-- Phase 1: apply with the Supabase SQL editor or Supabase CLI migrations.
begin;
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
commit;
