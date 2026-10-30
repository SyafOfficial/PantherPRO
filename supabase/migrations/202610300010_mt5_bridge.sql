begin;
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
commit;
