begin;
alter table public.signals add column strategy text check(strategy in ('QM','QMTR','BOS','CHOCH','TRENDLINE'));
alter table public.signals add column timeframe text check(timeframe in ('M30','H1','H4','D1','W1'));
alter table public.signals add column higher_timeframe text check(higher_timeframe in ('M30','H1','H4','D1','W1'));
create function public.timeframe_minutes(value text) returns integer language sql immutable set search_path='' as $$
 select case value when 'M30' then 30 when 'H1' then 60 when 'H4' then 240 when 'D1' then 1440 when 'W1' then 10080 else null end;
$$;
alter table public.signals add constraint valid_signal_method check((strategy is null and timeframe is null and higher_timeframe is null) or (strategy is not null and timeframe is not null and (higher_timeframe is null or public.timeframe_minutes(higher_timeframe)>public.timeframe_minutes(timeframe))));
create function public.protect_signal_method() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('active','closed') and (new.strategy is distinct from old.strategy or new.timeframe is distinct from old.timeframe or new.higher_timeframe is distinct from old.higher_timeframe) then raise exception 'Published strategy and timeframe tags are immutable';end if;
 return new;
end;
$$;
create trigger protect_signal_method before update on public.signals for each row execute function public.protect_signal_method();
revoke all on function public.protect_signal_method() from public,anon,authenticated;

create or replace function public.ingest_tradingview(alert jsonb,fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 insert into public.signals(instrument,direction,entry,stop_loss,tp1,tp2,tp3,reasoning,access,source,source_event_id,source_fingerprint,source_timestamp,created_by,strategy,timeframe,higher_timeframe)
 values(alert->>'instrument',alert->>'direction',(alert->>'entry')::numeric,(alert->>'stop_loss')::numeric,(alert->>'tp1')::numeric,(alert->>'tp2')::numeric,(alert->>'tp3')::numeric,alert->>'reasoning',alert->>'access','tradingview',alert->>'event_id',fingerprint,alert_time,null,alert->>'strategy',alert->>'timeframe',alert->>'higher_timeframe') returning id into new_id;
 update public.signals set status='pending' where id=new_id;
 return jsonb_build_object('id',new_id,'duplicate',false,'status','pending');
end;
$$;
create or replace function public.revise_signal(signal_id uuid,expected_version integer,changes jsonb,revision_reason text) returns void language plpgsql security definer set search_path='' as $$
declare old_signal public.signals;new_signal public.signals;event_name text;
begin
 if not public.is_admin() then raise exception 'Administrator required';end if;
 if length(trim(revision_reason)) not between 10 and 500 then raise exception 'Revision reason required';end if;
 select * into old_signal from public.signals where id=signal_id for update;
 if not found or old_signal.status='closed' then raise exception 'Editable signal not found';end if;
 if old_signal.version is distinct from expected_version then raise exception 'Stale revision; reload before editing';end if;
 if old_signal.status='active' and ((changes->>'entry')::numeric is distinct from old_signal.entry or changes->>'direction' is distinct from old_signal.direction or changes->>'access' is distinct from old_signal.access) then raise exception 'Published entry, direction and access cannot change';end if;
 update public.signals set strategy=case when changes?'strategy' then changes->>'strategy' else strategy end,timeframe=case when changes?'timeframe' then changes->>'timeframe' else timeframe end,higher_timeframe=case when changes?'higher_timeframe' then changes->>'higher_timeframe' else higher_timeframe end,direction=changes->>'direction',entry=(changes->>'entry')::numeric,stop_loss=(changes->>'stop_loss')::numeric,tp1=(changes->>'tp1')::numeric,tp2=(changes->>'tp2')::numeric,tp3=(changes->>'tp3')::numeric,reasoning=changes->>'reasoning',access=changes->>'access',version=version+1,updated_at=now() where id=signal_id returning * into new_signal;
 insert into public.audit_logs(actor_id,action,entity_id,details) values(auth.uid(),'signal.revised',signal_id,jsonb_build_object('reason',revision_reason,'before',to_jsonb(old_signal),'after',to_jsonb(new_signal)));
 if old_signal.status='active' then
  event_name=case when old_signal.stop_loss<>new_signal.stop_loss then 'signal.stop_loss' else 'signal.modified' end;
  insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values(signal_id::text||':revision:'||new_signal.version,signal_id,event_name,new_signal.access,jsonb_build_object('signal_id',signal_id,'version',new_signal.version));
 end if;
end;
$$;
commit;
