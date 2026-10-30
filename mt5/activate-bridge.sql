-- PantherPRO bridge upgrade: apply ONCE after initial setup migrations 001-008.
-- Adds setup timeframes and private signed snapshot ingestion. Does NOT publish signals.
BEGIN;

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


-- Private ingestion storage only. Does not grant display/redistribution rights or publish signals.
create table public.mt5_bridge_latest (
 source text primary key check(source='vestrado'),snapshot jsonb not null,
 exported_at timestamptz not null,received_at timestamptz not null default now()
);
create table public.mt5_bridge_receipts (
 exported_at timestamptz primary key,fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),received_at timestamptz not null default now()
);
alter table public.mt5_bridge_latest enable row level security;
alter table public.mt5_bridge_receipts enable row level security;
revoke all on public.mt5_bridge_latest,public.mt5_bridge_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.mt5_bridge_latest,public.mt5_bridge_receipts to service_role;
create function public.ingest_mt5_snapshot(snapshot jsonb,fingerprint text,export_time timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing text;latest_time timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if fingerprint !~ '^[a-f0-9]{64}$' or snapshot->>'schema' is distinct from 'panther.mt5.snapshot.v1' or snapshot->>'symbol' is distinct from 'XAUUSD.V' or snapshot->>'provider' is distinct from 'Vestrado MT5' or snapshot->>'bar_time_basis' is distinct from 'broker_server' or snapshot->>'execution_enabled' is distinct from 'false' or pg_column_size(snapshot)>2097152 or export_time is null or export_time>now()+interval '5 seconds' or export_time<now()-interval '30 seconds' then raise exception 'Invalid snapshot';end if;
 if to_char(export_time at time zone 'UTC','YYYY.MM.DD HH24:MI:SS') is distinct from snapshot->>'exported_at_utc' then raise exception 'Export time mismatch';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('panther-mt5-vestrado'));
 select r.fingerprint into existing from public.mt5_bridge_receipts r where r.exported_at=export_time;
 if found then
  if existing is distinct from fingerprint then raise exception using errcode='P0409',message='Conflicting snapshot';end if;
  return jsonb_build_object('duplicate',true);
 end if;
 select exported_at into latest_time from public.mt5_bridge_latest where source='vestrado';
 if latest_time is not null and export_time<=latest_time then raise exception using errcode='P0409',message='Out of order snapshot';end if;
 if (select count(*) from public.mt5_bridge_receipts where received_at>now()-interval '1 minute')>=12 then raise exception using errcode='P0429',message='Bridge rate limit';end if;
 insert into public.mt5_bridge_receipts values(export_time,fingerprint,now());
 insert into public.mt5_bridge_latest(source,snapshot,exported_at,received_at) values('vestrado',snapshot,export_time,now()) on conflict(source) do update set snapshot=excluded.snapshot,exported_at=excluded.exported_at,received_at=excluded.received_at;
 delete from public.mt5_bridge_receipts where received_at<now()-interval '24 hours';
 return jsonb_build_object('duplicate',false);
end;
$$;
revoke all on function public.ingest_mt5_snapshot(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ingest_mt5_snapshot(jsonb,text,timestamptz) to service_role;

COMMIT;
