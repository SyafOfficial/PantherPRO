begin;
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
commit;
