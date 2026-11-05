begin;
-- Preserve the original setup start, not this fix's deployment time. Accounts
-- registered after onboarding launched must never inherit the team exception.
alter table public.client_access_policy add column setup_started_at timestamptz;
update public.client_access_policy set setup_started_at=updated_at where singleton;
alter table public.client_access_policy alter column setup_started_at set not null;
create or replace function public.client_access_allowed_for(owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.profiles p cross join public.client_access_policy c
  where p.id=owner and c.singleton and (
   p.role='admin' or (
    not exists(select 1 from public.client_applications a where a.user_id=owner and a.status='revoked')
    and (
     exists(select 1 from public.client_applications a where a.user_id=owner and a.status='approved')
     or (not c.enforced and p.created_at<=c.setup_started_at)
    )
   )
  )
 );
$$;
revoke all on function public.client_access_allowed_for(uuid) from public,anon,authenticated;
commit;
