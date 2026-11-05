begin;
alter table public.signals add column client_desk_visible boolean not null default true;
-- Curate only the existing closed history. Future publications keep the default,
-- regardless of whether they eventually reach TP, SL or BE.
update public.signals set client_desk_visible=false where published_at is not null and status='closed';
update public.signals set client_desk_visible=true where id in (
 select id from public.signals where published_at is not null and status='closed'
 and (tp1_hit_at is not null or tp2_hit_at is not null or tp3_hit_at is not null)
 order by published_at desc,id limit 2
);
drop policy signals_read on public.signals;
create policy signals_read on public.signals for select to authenticated using (
 public.is_admin() or (
  client_desk_visible and status in ('pending','active','closed')
  and published_at is not null and (status='active' or published_at>now()-interval '30 days')
  and (access='public' or public.is_member())
 )
);
create index signals_client_recent on public.signals(published_at desc,id) where client_desk_visible and published_at is not null;
commit;
