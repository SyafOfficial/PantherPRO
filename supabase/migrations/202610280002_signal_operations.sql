begin;
alter table public.signals add column version integer not null default 1;
alter table public.signals add column source_fingerprint text;
alter table public.signals add column source_timestamp timestamptz;
create or replace function public.audit_signal_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'draft' or new.approved_by is not null or new.published_at is not null or new.closed_at is not null or new.tp1_hit_at is not null or new.tp2_hit_at is not null or new.tp3_hit_at is not null or new.outcome is not null or new.pricing_source is not null or new.max_favorable_movement is not null or new.break_even then raise exception 'Signals must start as unapproved drafts without outcomes';end if;
 new.created_at=now();new.updated_at=now();new.version=1;
 if auth.role()='service_role' and new.source='tradingview' and new.created_by is null and new.source_event_id is not null and new.source_fingerprint is not null then
  insert into public.audit_logs(actor_id,action,entity_id) values(null,'signal.ingested',new.id);
 else
  if not public.is_admin() or new.source<>'manual' or new.created_by is distinct from auth.uid() or new.source_event_id is not null or new.source_fingerprint is not null or new.source_timestamp is not null then raise exception 'Administrator manual draft required';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('signal-create:'||auth.uid()::text));
  if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='signal.created' and created_at>now()-interval '1 minute')>=20 then raise exception 'Signal creation rate limit exceeded';end if;
  insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'signal.created',new.id);
 end if;return new;
end;
$$;
create function public.ingest_tradingview(alert jsonb,fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.signals;new_id uuid;alert_time timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if fingerprint !~ '^[a-f0-9]{64}$' or alert->>'event_id' !~ '^[A-Za-z0-9._:-]{8,128}$' then raise exception 'Invalid event';end if;
 alert_time=(alert->>'timestamp')::timestamptz;
 if alert_time is null or abs(extract(epoch from (now()-alert_time)))>300 then raise exception 'Stale alert';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tradingview-ingest'));
 select * into existing from public.signals where source='tradingview' and source_event_id=alert->>'event_id';
 if found then
  if existing.source_fingerprint is distinct from fingerprint then raise exception using errcode='P0409',message='Conflicting event';end if;
  return jsonb_build_object('id',existing.id,'duplicate',true,'status',existing.status);
 end if;
 if (select count(*) from public.audit_logs where action='signal.ingested' and created_at>now()-interval '1 minute')>=60 then raise exception using errcode='P0429',message='Ingestion rate exceeded';end if;
 insert into public.signals(instrument,direction,entry,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by)
 values(alert->>'instrument',alert->>'direction',(alert->>'entry')::numeric,(alert->>'stop_loss')::numeric,(alert->>'tp1')::numeric,(alert->>'tp2')::numeric,(alert->>'tp3')::numeric,alert->>'reasoning',alert->>'access','tradingview',alert->>'event_id',fingerprint,alert_time,null) returning id into new_id;
 update public.signals set status='pending' where id=new_id;
 return jsonb_build_object('id',new_id,'duplicate',false,'status','pending');
end;
$$;
create function public.revise_signal(signal_id uuid,expected_version integer,changes jsonb,revision_reason text) returns void language plpgsql security definer set search_path='' as $$
declare old_signal public.signals;new_signal public.signals;event_name text;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 if length(trim(revision_reason)) not between 10 and 500 then raise exception 'Revision reason required';end if;
 select * into old_signal from public.signals where id=signal_id for update;
 if not found or old_signal.status='closed' then raise exception 'Editable signal not found';end if;
 if old_signal.version is distinct from expected_version then raise exception 'Stale revision; reload before editing';end if;
 if old_signal.status='active' and ((changes->>'entry')::numeric is distinct from old_signal.entry or changes->>'direction' is distinct from old_signal.direction or changes->>'access' is distinct from old_signal.access) then raise exception 'Published entry, direction and access cannot change';end if;
 update public.signals set direction=changes->>'direction',entry=(changes->>'entry')::numeric,stop_loss=(changes->>'stop_loss')::numeric,tp1=(changes->>'tp1')::numeric,tp2=(changes->>'tp2')::numeric,tp3=(changes->>'tp3')::numeric,reasoning=changes->>'reasoning',access=changes->>'access',version=version+1,updated_at=now() where id=signal_id returning * into new_signal;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'signal.revised',signal_id,jsonb_build_object('reason',revision_reason,'before',to_jsonb(old_signal),'after',to_jsonb(new_signal)));
 if old_signal.status='active' then
  event_name=case when old_signal.stop_loss<>new_signal.stop_loss then 'signal.stop_loss' else 'signal.modified' end;
  insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(signal_id::text||':revision:'||new_signal.version,signal_id,event_name,new_signal.access,jsonb_build_object('signal_id',signal_id,'version',new_signal.version));
 end if;
end;
$$;
-- A transition increments version so an open edit form cannot overwrite a newer lifecycle state.
create function public.bump_signal_transition_version() returns trigger language plpgsql set search_path='' as $$
begin if new.status is distinct from old.status then new.version=old.version+1;end if;return new;end;
$$;
create trigger signal_transition_version before update on public.signals for each row execute function public.bump_signal_transition_version();
create function public.publish_announcement(heading text,content text,audience text) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('announcement:'||auth.uid()::text));
 if (select count(*) from public.audit_logs where actor_id=auth.uid() and action='announcement.published' and created_at>now()-interval '1 minute')>=10 then raise exception 'Announcement rate exceeded';end if;
 insert into public.announcements(title,body,access,published_at) values(heading,content,audience,now()) returning id into new_id;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'announcement.published',new_id);
 insert into public.notification_outbox(event_key,event_type,access,payload) values('announcement:'||new_id,'announcement.published',audience,jsonb_build_object('announcement_id',new_id));
 return new_id;
end;
$$;
revoke all on function public.ingest_tradingview(jsonb,text),public.revise_signal(uuid,integer,jsonb,text),public.bump_signal_transition_version(),public.publish_announcement(text,text,text) from public,anon,authenticated;
grant execute on function public.ingest_tradingview(jsonb,text) to service_role;
grant execute on function public.revise_signal(uuid,integer,jsonb,text),public.publish_announcement(text,text,text) to authenticated;
commit;
