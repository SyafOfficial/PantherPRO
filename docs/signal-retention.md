# Signal Desk retention

Proposed policy: keep active, pending and draft signals. Remove only signals whose `status='closed'` and `closed_at` is strictly more than 30 days old. Age is measured from closure, so a long-running active signal gets 30 days of closed history too. No deletion occurs merely because a calendar month changes.

Run daily at 03:15 Asia/Kuala_Lumpur (`15 19 * * *` UTC) through Supabase Cron, without an extra Render service. `pg_cron` is enabled in production and the named job is active. Up to 5,000 old signals are removed in bounded 500-row batches per run. Active delivery leases are skipped and retried by a later run.

The cleanup removes a selected signal's delivery rows, notification outbox and automatic tracking before its signal row, in one transaction. Accounts, memberships, preferences, subscriptions, news, prices and owner-shadow diagnostics are outside this policy. Audit records are preserved. Minimal source identity/fingerprint keys are retained to stop a deleted event being republished; they contain no prices, reasoning, notification payloads or account credentials. This retention is physical deletion, so the old Signal Desk content will no longer be available in the app.

The cleanup function is SECURITY INVOKER with EXECUTE revoked from browser roles and service_role; it runs only as its database owner via Cron. No delete rights are granted to clients. A partial index supports the closed-age filter. Standard autovacuum reclaims dead row space for reuse; the database's allocated size may not immediately fall after deletion. No VACUUM FULL or locking table rewrite is scheduled.

Rollout order: apply the reviewed quote/M5 proposal, then `signal_retention_30_days.sql` (which preserves those M5 rules while adding retired-key duplicate guards), then `schedule_signal_retention.sql`, recording migration versions. Verify the cron job's active state, UTC schedule and first successful run. Do not run the quoted SL/TP proposal again afterward without retaining the duplicate guards. Production migrations `20261104081855` and `20261104082950` were applied after owner approval. The first maintenance verification returned zero eligible deletions. The next scheduled execution still requires its normal cron run to be observed.

Initial read-only inspection: 4 closed signals; no signals closed more than 30 days ago; signals storage about 64 kB and database about 15 MB. These are observations at inspection time, not hard limits or projected savings.
