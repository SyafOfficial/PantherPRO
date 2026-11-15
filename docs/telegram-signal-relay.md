# Apps signals → Telegram

Apps push is unchanged. The worker runs a fourth independent, non-overlapping task loop. A service-only RPC copies future published signal outbox events into a private Telegram queue. It never consumes or updates the apps outbox, and publication has no Telegram trigger or network dependency.

Rollout: apply the queue migration (disabled by default), publish the private Site receiver, configure only the worker's TELEGRAM_SIGNAL_RELAY_URL, TELEGRAM_SIGNAL_GATEWAY_TOKEN and TELEGRAM_SIGNAL_SIGNING_KEY, deploy the tested worker, then perform a signed `probe` without posting. Enable telegram_signal_policy and set starts_at to activation time only after both sides are ready. Do not backfill historical outbox events. Existing signals without a forwarded entry have their later updates excluded.

The destination requires private Site service access and a timestamped HMAC signature. Bot credentials stay encrypted in the owner-private Site; they are not copied into PantherPRO. Each signal's first message is recorded as its root; TP/BE/SL reply to that root in the original channel. Stable event IDs, a destination send claim and payload hashes prevent repeated sends. Unknown provider outcomes become review items instead of being automatically resent. Node retries a failed relay request with the same event identity; leases fence stale worker completions. Retries are bounded and stale delivery expires after one hour.

The Site owner can pause automatic signals from Settings. Events received while paused are skipped, not replayed on resume. A changed channel does not receive replies belonging to an old channel thread. Delivery acceptance is not broker execution or proof of device display. No historical or fabricated trading signals should be sent as a connectivity test; signed probe mode is sufficient for service verification.

Rollback: disable telegram_signal_policy and retain queues/audit history. The apps engine, apps push and calendar keep their existing loops. Remove or correct only relay environment keys; retain all unrelated service configuration.
