-- Index the time filters used on every accepted MT5 snapshot for rate limits
-- and receipt retention. Keep all ingestion, ordering and publication rules.
set local lock_timeout = '3s';
set local statement_timeout = '15s';
create index if not exists mt5_bridge_receipts_received_at_idx
  on public.mt5_bridge_receipts (received_at);
