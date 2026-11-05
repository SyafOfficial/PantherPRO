begin;
alter table public.client_applications add column reviewed_bonus_comments text[] not null default '{}';
create function public.update_client_connection(owner uuid,expected_revision uuid,server_name text,encrypted text) returns boolean language plpgsql security definer set search_path='' as $$
declare a public.client_applications;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if server_name<>'Vestrado-Server' or length(encrypted) not between 20 and 1000 then raise exception 'Invalid connection';end if;
 select * into a from public.client_applications where user_id=owner for update;
 if not found or a.revision<>expected_revision or a.status='revoked' then return false;end if;
 if a.status='approved' and lower(a.server)<>lower(server_name) then raise exception 'Approved account server requires administrator review';end if;
 update public.client_credentials set ciphertext=encrypted where user_id=owner;
 if not found then raise exception 'Credential record missing';end if;
 update public.client_applications set server=server_name,revision=gen_random_uuid(),last_checked_at=null,
 reason=case when status='pending' then 'verification_pending' else reason end where user_id=owner;
 insert into public.client_access_events(user_id,kind,reason) values(owner,'connection_updated','Investor credential updated; access decision and activity clocks retained');
 insert into public.audit_logs(actor_id,action,entity_id,details) values(owner,'client.connection_updated',owner,jsonb_build_object('server',server_name));
 return true;
end;$$;
revoke all on function public.update_client_connection(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_client_connection(uuid,uuid,text,text) to service_role;
commit;
