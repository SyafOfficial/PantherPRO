begin;
alter table public.notification_preferences add column push_enabled boolean not null default false;
alter table public.notification_outbox add column prepared_at timestamptz;
alter table public.notification_outbox add column recipient_id uuid references public.profiles(id) on delete cascade;
alter table public.notification_deliveries drop constraint notification_deliveries_state_check;
alter table public.notification_deliveries add constraint notification_deliveries_state_check check(state in ('pending','processing','delivered','failed','skipped'));
alter table public.notification_deliveries add column next_attempt_at timestamptz not null default now();
alter table public.notification_deliveries add column lease_until timestamptz;
alter table public.notification_deliveries add column lease_token uuid;
create index push_delivery_ready_idx on public.notification_deliveries(state,next_attempt_at);
-- Expired subscriptions are retained as inactive to preserve delivery logs.
alter table public.push_subscriptions add column active boolean not null default true;
revoke insert,update,delete on public.push_subscriptions from authenticated;
create function public.register_push_subscription(subscription jsonb) returns void language plpgsql security definer set search_path='' as $$
declare endpoint_value text;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 endpoint_value=subscription->>'endpoint';
 if endpoint_value !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^[:space:]]+$' or length(endpoint_value)>2048 or (subscription->'keys'->>'p256dh') !~ '^[A-Za-z0-9_-]{87}$' or (subscription->'keys'->>'auth') !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Unsupported subscription';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('push-register:'||auth.uid()::text));
 if (select count(*) from public.push_subscriptions where user_id=auth.uid() and active)>=10 and not exists(select 1 from public.push_subscriptions where endpoint=endpoint_value and user_id=auth.uid() and active) then raise exception 'Device limit reached';end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values(auth.uid(),endpoint_value,subscription->'keys'->>'p256dh',subscription->'keys'->>'auth')
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,active=true where public.push_subscriptions.user_id=auth.uid();
 if not found then raise exception 'Subscription unavailable';end if;
 insert into public.notification_preferences(user_id,push_enabled) values(auth.uid(),true) on conflict(user_id) do update set push_enabled=true,updated_at=now();
end;
$$;
create function public.remove_push_subscription(subscription_endpoint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 update public.push_subscriptions set active=false where endpoint=subscription_endpoint and user_id=auth.uid();
 if not exists(select 1 from public.push_subscriptions where user_id=auth.uid() and active) then update public.notification_preferences set push_enabled=false,updated_at=now() where user_id=auth.uid();end if;
end;
$$;
create function public.notification_allowed(event_id uuid,device_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notification_outbox o
 join public.push_subscriptions s on s.id=device_id and s.active
 join public.profiles p on p.id=s.user_id
 join public.notification_preferences n on n.user_id=p.id and n.push_enabled
 where o.id=event_id and o.created_at>now()-interval '24 hours'
 and (o.recipient_id is null or o.recipient_id=p.id)
 and (o.access='public' or p.role in ('vip','admin'))
 and (o.signal_id is null or exists(select 1 from public.signals x where x.id=o.signal_id and x.published_at is not null and (x.access='public' or p.role in ('vip','admin'))))
 and case when o.event_type='push.test' then o.recipient_id=p.id
  when o.event_type in ('signal.active','signal.modified','signal.closed') then n.signals
  when o.event_type in ('signal.stop_loss','signal.tp1','signal.tp2','signal.tp3','signal.break_even') then n.targets
  when o.event_type in ('news.upcoming','news.released') then n.news
  when o.event_type='announcement.published' then n.announcements else false end);
$$;
create function public.enqueue_test_notification() returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('push-test:'||auth.uid()::text));
 if exists(select 1 from public.notification_outbox where recipient_id=auth.uid() and event_type='push.test' and created_at>now()-interval '1 minute') then raise exception 'Test rate exceeded';end if;
 if not exists(select 1 from public.notification_preferences where user_id=auth.uid() and push_enabled) or not exists(select 1 from public.push_subscriptions where user_id=auth.uid() and active) then raise exception 'Enable push first';end if;
 new_id=gen_random_uuid();
 insert into public.notification_outbox(id,event_key,event_type,access,recipient_id) values(new_id,'test:'||new_id,'push.test','public',auth.uid());
 return new_id;
end;
$$;
create function public.prepare_push_deliveries(batch_size integer default 20) returns integer language plpgsql security definer set search_path='' as $$
declare item public.notification_outbox;total integer=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_outbox where prepared_at is null and state='pending' order by created_at for update skip locked limit least(greatest(batch_size,1),100) loop
  insert into public.notification_deliveries(outbox_id,subscription_id,state)
  select item.id,s.id,'pending' from public.push_subscriptions s where public.notification_allowed(item.id,s.id) on conflict(outbox_id,subscription_id) do nothing;
  update public.notification_outbox set prepared_at=now(),state=case when exists(select 1 from public.notification_deliveries where outbox_id=item.id) then 'processing' else 'delivered' end where id=item.id;
  total=total+1;
 end loop;return total;
end;
$$;
create function public.claim_push_deliveries(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.notification_deliveries;result jsonb='[]';token uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for item in select * from public.notification_deliveries where (state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<now()) order by next_attempt_at for update skip locked limit least(greatest(batch_size,1),100) loop
  if item.attempts>=5 then update public.notification_deliveries set state='failed',error_code='attempts_exhausted' where id=item.id;continue;end if;
  if not public.notification_allowed(item.outbox_id,item.subscription_id) then update public.notification_deliveries set state='skipped',error_code='no_longer_eligible' where id=item.id;continue;end if;
  token=gen_random_uuid();
  update public.notification_deliveries set state='processing',attempts=attempts+1,lease_token=token,lease_until=now()+interval '2 minutes' where id=item.id;
  result=result||(select jsonb_build_array(jsonb_build_object('id',item.id,'outbox_id',item.outbox_id,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,'lease_token',token,'attempts',item.attempts+1,'event_type',o.event_type,'signal_id',o.signal_id)) from public.push_subscriptions s,public.notification_outbox o where s.id=item.subscription_id and o.id=item.outbox_id);
 end loop;return result;
end;
$$;
create function public.finish_push_delivery(delivery_id uuid,claim_token uuid,result_state text,failure_code text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare item public.notification_deliveries;new_state text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if result_state not in ('delivered','retry','failed','expired','skipped') then raise exception 'Invalid result';end if;
 select * into item from public.notification_deliveries where id=delivery_id and state='processing' and lease_token=claim_token and lease_until>now() for update;
 if not found then return false;end if;
 new_state=case when result_state='retry' and item.attempts<5 then 'pending' when result_state in ('retry','expired') then 'failed' else result_state end;
 update public.notification_deliveries set state=new_state,error_code=left(failure_code,80),delivered_at=case when new_state='delivered' then now() else null end,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,item.attempts-1)::integer)),lease_until=null,lease_token=null where id=delivery_id;
 if result_state='expired' then update public.push_subscriptions set active=false where id=item.subscription_id;end if;
 return true;
end;
$$;
create function public.finalize_push_events() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 update public.notification_outbox o set state=case when exists(select 1 from public.notification_deliveries d where d.outbox_id=o.id and d.state='failed') then 'failed' else 'delivered' end
 where o.prepared_at is not null and o.state='processing' and not exists(select 1 from public.notification_deliveries d where d.outbox_id=o.id and d.state in ('pending','processing'));
end;
$$;
revoke all on function public.register_push_subscription(jsonb),public.remove_push_subscription(text),public.enqueue_test_notification(),public.notification_allowed(uuid,uuid),public.prepare_push_deliveries(integer),public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,text),public.finalize_push_events() from public,anon,authenticated;
grant execute on function public.register_push_subscription(jsonb),public.remove_push_subscription(text),public.enqueue_test_notification() to authenticated;
grant execute on function public.notification_allowed(uuid,uuid),public.prepare_push_deliveries(integer),public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,text),public.finalize_push_events() to service_role;
commit;
