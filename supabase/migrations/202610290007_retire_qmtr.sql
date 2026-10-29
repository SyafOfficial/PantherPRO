begin;
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
commit;
