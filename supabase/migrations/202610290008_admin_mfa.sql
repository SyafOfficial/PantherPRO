begin;
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
commit;
