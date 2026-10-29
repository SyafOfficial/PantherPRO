# Phase 2 integrations and testing

Implemented endpoints and workers are described below. They are **unconfigured and unverified against external services** in this environment. Never put secrets in Git, chat, screenshots or logs.

## Database setup

Apply all files in `supabase/migrations/` in filename order, once, to your Supabase project. If Phase 1 is already deployed, apply only the additional migrations. `npm test` applies the actual SQL to local PGlite PostgreSQL with mock Auth identities and verifies RLS, RPC permissions, lifecycle, idempotency, revisions and notification jobs. This does not test Supabase's actual Auth/PostgREST/realtime services.

## TradingView webhook

Endpoint: `POST /api/webhooks/tradingview`. It requires server-only `SUPABASE_SERVICE_ROLE_KEY` and `TRADINGVIEW_WEBHOOK_SECRET`, plus the Supabase project URL. Generate a secret with `npm run webhook:secret`; the command writes an ignored, owner-readable `.env.webhook.local` and never prints its contents. Merge the setting securely into the app's `.env.local` or deployment secret store, and configure it in an authorized TradingView alert. Do not expose this secret through a `NEXT_PUBLIC_` variable or a webhook URL.

The alert must send JSON. TradingView does not support arbitrary custom HMAC headers, so the route authenticates a body secret over HTTPS. Restrict access to alert configuration, disable request-body logging at the deployment edge and rotate this secret after suspected disclosure. Size is capped at 8 KiB; a database-backed, globally serialized limit permits 60 unique accepted alerts per minute. Configure perimeter rate limits too: unauthenticated attempts are rejected before the database and need an edge abuse limit. The stored event, fingerprint and audit trail do not contain the secret.

Example shape, with **fictional prices** and placeholders to replace securely in TradingView:

```json
{
  "secret": "REPLACE_IN_TRUSTED_ALERT_CONFIGURATION",
  "event_id": "xauusd-UNIQUE_SOURCE_EVENT_ID",
  "timestamp": "2026-10-28T10:00:00Z",
  "instrument": "XAUUSD",
  "direction": "BUY",
  "strategy": "BOS",
  "timeframe": "M30",
  "higher_timeframe": "H4",
  "entry": 2000,
  "stop_loss": 1990,
  "tp1": 2010,
  "tp2": 2020,
  "tp3": 2030,
  "reasoning": "Fictional staging setup with defined risk and ordered targets.",
  "access": "public"
}
```

Use a real current UTC ISO timestamp (e.g. TradingView's supported `{{timenow}}` placeholder), stable event ID per alert occurrence, and values supplied by your authorized deterministic strategy. Alerts outside ±5 minutes are rejected, including retries after that window. Unknown keys, invalid levels and unsupported instruments are rejected. A repeated event ID with the same canonical payload returns the existing record; changed content with that ID returns 409. Alert timestamps must remain stable on retry. The server never accepts a signal based only on AI text.

Accepted alerts return 202 with an ID and `status: pending`; identical replay returns 200 with `duplicate: true`. Every alert requires admin approval and remains invisible to clients until published. No trades execute. When unconfigured, the route returns 503 and writes nothing.

### Staging acceptance

1. Configure a staging Supabase project, all migrations and the HTTPS webhook route.
2. Send a valid current staging alert using your secure client. Verify one pending record and `signal.ingested` audit. Replay exactly and verify no duplicate; change the entry without changing ID and expect 409.
3. Check wrong/missing secret, stale timestamp, invalid levels, unknown keys, oversized and non-JSON input; verify no writes. Check burst limits at both the edge and database.
4. Approve as admin; verify public/VIP visibility and one queue event. Refresh a second admin's stale edit form and confirm the revision is rejected.
5. Configure a real TradingView alert and observe its delivery, acknowledgment and retry behavior. TradingView's delivery deadline is short; measure database latency and investigate slow acknowledgments before production.

Local automated tests cover validation and the database ingestion RPC. A real TradingView alert has not been sent.

## Web Push

Required: HTTPS application, Supabase service key, VAPID pair and a real contact subject. Generate keys with `npm run push:keys`; this writes `.env.push.local` with mode 0600 and refuses to overwrite an existing file. Set a real `VAPID_SUBJECT` (`mailto:` or HTTPS operator contact) and securely merge the generated values into `.env.local` and the deployment. Next.js does **not** automatically load `.env.push.local`. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is public; `VAPID_PRIVATE_KEY` stays server-side. Rebuild the app after setting the public key. Use the same pair for the web app and worker.

Run the persistent worker separately:

```sh
npm run push:worker
# Or process one bounded batch from a scheduler:
npm run push:worker -- --once
```

The worker refuses to start if required values are absent. It runs separately from Next.js, uses database row locks and expiring claim tokens, and retries transient network errors / HTTP 429 / 5xx with exponential backoff (five attempts maximum). Expired 404/410 devices become inactive without deleting delivery history. Other permanent failures stop retrying. Worker logs contain delivery IDs and generic statuses, not subscription endpoints, keys, alert bodies or provider error bodies.

Visit `/account` to save notification categories, enable a device after explicit user permission, remove that device, and queue a personal test (one/minute). All browser mutations require a same-origin request and a verified session. Registering a device enables the account's global push preference. Turning that global preference off suppresses all devices; removing one device keeps other device settings. If an endpoint belongs to another account, registration fails safely: unregister on the old account/browser before registering the new account. On sign-out the browser subscription is deactivated server-side and unsubscribed locally; this requires a working network connection. Manually subscribed other devices retain their state.

Notifications recheck current membership, publication status and category preferences at fanout, claim and immediately before sending. A revocation racing with an already-sent network request cannot recall a push; payloads are therefore generic and contain no VIP prices, reasoning, announcement text or account identity. Clicking reopens a server-authorized page. Supported endpoint hosts are FCM, Mozilla Autopush, Apple Web Push and Microsoft WNS. Other services fail closed; do not broaden this to arbitrary URLs. HTTPS URLs with credentials, custom ports, fragments, private hosts and lookalike domains are rejected.

Unique event/device rows prevent ordinary duplicates. A worker crash after provider acceptance but before database acknowledgment can cause a retry; stable delivery IDs and browser IndexedDB deduplication reduce repeat display. Exactly-once device delivery cannot be guaranteed. The service worker never accepts arbitrary cross-origin notification links and never caches member/market content.

### Real device acceptance — not yet run

1. Install/open the HTTPS app on a supported device (on iOS, use a Home Screen web app). Sign in, allow push with **Enable this device**, and save desired categories.
2. Run the worker. Use **Send a test push**, background/close the app, and observe an actual OS notification. Follow its link. Record browser/OS, timestamps and outbox/delivery IDs.
3. Publish an admin-reviewed staging signal; verify one notification per opted-in eligible device. Verify announcement and stop-loss-change events.
4. Replay the source event and observe no duplicate. Revoke VIP before the next VIP event and verify no delivery. Disable a category; remove a device; verify suppression. Simulate transient provider failures to verify retries and 410 invalidation.
5. Inspect `/admin` delivery logs. `delivered` means **push-service acceptance**, not proof of OS display. A completed event with zero eligible recipients delivers no notification.

Local browser tests check disabled unconfigured controls and endpoint denial. PostgreSQL tests cover queue behavior. Actual push-service transport and physical-device display have not been verified. Target/stop observations and news events can be generated by the Phase 3 normalized import/observation model; no actual licensed feed is connected. See phase-3.md.

## Licensed data, reconciliation and AI

The Phase 3 normalized-data storage/reconciliation boundary is implemented (see [Phase 3](phase-3.md)); no live prices, release figures or AI analysis are connected. Obtain authorized XAUUSD data and a Trading Economics (or equivalent) calendar license covering display/redistribution. Define bid/ask/cost assumptions and reconcile chronological source quotes before marking TP, SL, break-even, maximum movement or historical outcomes. Until then those outcomes stay unavailable; administrator closure alone is not a win or loss.

Phase 4 analysis must use timestamped sources and structured bias (`bullish`, `bearish`, `neutral`, `insufficient_data`), conditional scenarios and limitations. No model output may bypass deterministic signal rules and review. Payments remain inactive schema infrastructure only.
