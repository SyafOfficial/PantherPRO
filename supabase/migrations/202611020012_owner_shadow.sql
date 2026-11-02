-- Private observation workspace only. No client signals or push outbox writes.
create table public.owner_shadow_setups (
 id text primary key check (length(id)=64),
 payload jsonb not null,
 progress jsonb not null default '{"targets":[],"invalidated":false,"lastQuote":0,"lastClose":0}',
 version bigint not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.owner_shadow_events (
 id text primary key,
 setup_id text not null references public.owner_shadow_setups(id),
 kind text not null check(kind in ('tp1','tp2','tp3','invalidation_m5')),
 observed_at timestamptz not null default now()
);
alter table public.owner_shadow_setups enable row level security;
alter table public.owner_shadow_events enable row level security;
revoke all on public.owner_shadow_setups,public.owner_shadow_events from public,anon,authenticated;
grant select on public.owner_shadow_setups,public.owner_shadow_events to service_role;
create function public.record_owner_shadow(proposal jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 if proposal->>'mode'<>'shadow_only' or proposal->>'status' not in ('monitor_zone','entry_confirmed') then raise exception 'Invalid shadow proposal'; end if;
 insert into owner_shadow_setups(id,payload) values(proposal->>'id',proposal)
 on conflict(id) do update set payload=excluded.payload, updated_at=now()
 where owner_shadow_setups.payload->>'status'='monitor_zone';
end; $$;
create function public.commit_owner_shadow_progress(setup_key text, expected_version bigint, next_progress jsonb, emitted jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update owner_shadow_setups set progress=next_progress,version=version+1,updated_at=now()
 where id=setup_key and version=expected_version and payload->>'status'='entry_confirmed';
 if not found then return false; end if;
 insert into owner_shadow_events(id,setup_id,kind)
 select value->>'id',setup_key,value->>'kind' from jsonb_array_elements(emitted)
 on conflict(id) do nothing;
 return true;
end; $$;
revoke all on function public.record_owner_shadow(jsonb) from public,anon,authenticated;
revoke all on function public.commit_owner_shadow_progress(text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_owner_shadow(jsonb) to service_role;
grant execute on function public.commit_owner_shadow_progress(text,bigint,jsonb,jsonb) to service_role;
