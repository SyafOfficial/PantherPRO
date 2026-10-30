begin;
-- D1 remains valid only for historical rows. New setup selection excludes D1 and M5.
alter table public.signals drop constraint signals_timeframe_check;
alter table public.signals drop constraint signals_higher_timeframe_check;
alter table public.signals add constraint signals_timeframe_check check(timeframe in ('M15','M30','H1','H4','D1','W1','MN1'));
alter table public.signals add constraint signals_higher_timeframe_check check(higher_timeframe in ('M15','M30','H1','H4','D1','W1','MN1'));
create or replace function public.timeframe_minutes(value text) returns integer language sql immutable set search_path='' as $$
 select case value when 'M15' then 15 when 'M30' then 30 when 'H1' then 60 when 'H4' then 240 when 'D1' then 1440 when 'W1' then 10080 when 'MN1' then 44640 else null end;
$$;
create function public.enforce_current_setup_timeframes() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.timeframe='D1' or new.higher_timeframe='D1' then raise exception 'D1 is not enabled for new setups';end if;
 else
  if (new.timeframe='D1' and new.timeframe is distinct from old.timeframe) or (new.higher_timeframe='D1' and new.higher_timeframe is distinct from old.higher_timeframe) then raise exception 'D1 is not enabled for new setups';end if;
 end if;
 return new;
end;
$$;
create trigger enforce_current_setup_timeframes before insert or update on public.signals for each row execute function public.enforce_current_setup_timeframes();
revoke all on function public.enforce_current_setup_timeframes() from public,anon,authenticated;
commit;
