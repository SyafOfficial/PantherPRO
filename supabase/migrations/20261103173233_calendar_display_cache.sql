begin;
create table public.calendar_display_cache (
 singleton boolean primary key default true check(singleton),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 fetched_at timestamptz not null
);
alter table public.calendar_display_cache enable row level security;
revoke all on public.calendar_display_cache from public,anon,authenticated;
grant select,insert,update on public.calendar_display_cache to service_role;
commit;
