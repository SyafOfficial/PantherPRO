# Phase 3: licensed data boundary and quote observation

Implemented locally: timestamped quote storage, provider gates, exact-reference idempotency, chronological quote rejection, quote freshness labels, explicit administrator-started signal observation, immutable observed targets, calendar revision history, Malaysia-time display, missing-value preservation and news outbox events.

**No provider-specific adapter or licensed account is connected.** Official vendor documentation could not be reached from this environment. The import contract below deliberately does not guess Trading Economics or any price vendor's API schema. Choose the licensed account and verify its current documentation before implementing the mapping. Test fixtures are fictional and exist only in automated tests; the application calendar never seeds them.

## Provider registration and normalized import

Apply migration `202610280004_licensed_data.sql` after migrations 001–003. Register a provider using a trusted SQL editor/controlled migration with its real display name, `kind` (`quotes` or `calendar`) and a non-secret internal `license_reference`. All flags default to false. Enable `enabled` only after verifying your authorized source; enable `display_allowed` only if the license permits display to these members; enable `reconciliation_allowed` only for a quote source suitable for this model. The database records operator configuration; it does not itself verify the contract. Ordinary members and client APIs cannot grant these flags.

`max_gap_seconds` defines quote freshness and the largest allowed interval between observations (default 60 seconds). Choose it based on the provider's actual delivery guarantees. Do not increase it merely to hide missing data. Quote sources stay separate; the engine will not bridge two providers to manufacture a continuous record.

The server-only import command accepts a normalized JSON object or array from an authorized provider adapter/export:

```sh
npm run data:import -- quote /secure/path/normalized-quotes.json
npm run data:import -- calendar /secure/path/normalized-calendar.json
```

It requires `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`, validates the complete batch before writing, caps input at 1 MiB / 500 rows, and imports sequentially. Each row is transactional, including its derived updates. If a later row fails, earlier rows remain imported; stable references make retry safe. It logs counts and generic rejection messages, not feed bodies or credentials. Live adapter orchestration/continuous polling remains unimplemented.

Quote fields: `provider_id` (registered UUID), `reference` (stable source ID), `instrument: XAUUSD`, positive finite numeric `bid`/`ask` with ask ≥ bid, and UTC/offset ISO `observed_at`. Quotes older than the configured freshness window, more than five seconds in the future, or out of chronological order are rejected. Exact duplicates acknowledge the existing record; conflicting reuse of a reference is rejected. Receipt time is server-generated. Do not invent bid/ask spreads if the provider only supplies midpoint prices.

Calendar fields: `provider_id`, `reference`, `name`, `country: United States`, `currency: USD`, ISO `event_time`, nullable string `previous`/`forecast`/`actual`, `importance: low|medium|high`, ISO `source_updated_at`, and attributable HTTPS `source_url`. Source time must not be in the future beyond clock tolerance. A missing figure must be JSON null, never zero or a model-generated value. Store values with their supplied units. Actual figures for future releases are rejected. Newer revisions preserve the original payload in an admin-only history; stale or conflicting same-timestamp revisions are rejected.

The member dashboard only reads enabled display-permitted sources, including for administrators viewing the client terminal. Prices show bid, source timestamp and a stale label when appropriate; the chart does not invent candlesticks from sparse quotes. Calendar cards show previous/consensus/actual, source, source-update time, revision and Malaysia time. A displayed record is not proof of a continuously connected vendor service. No directional AI interpretation is invented.

## Explicit quote observation model

Publish a reviewed signal, then open its observation control in `/admin`. Select a fresh permitted quote after publication and choose **Review & start observation**. This is an explicit theoretical quote-touch model (`quote_touch_v1`), not an order, broker fill, account position or verified trading result.

- BUY baseline requires ask ≤ stated entry and bid > stop; SELL requires bid ≥ entry and ask < stop. Ambiguous baseline quotes are rejected.
- Model entry reference is baseline ask for BUY, bid for SELL. Subsequent target/stop comparisons use bid for BUY exits and ask for SELL exits.
- Target observations are recorded once with source quote IDs and audit entries. A jump beyond several targets can observe several at that quote's timestamp; the engine does not invent an intratick path or precise target execution price.
- Favorable movement is observed executable-side movement from the baseline, floored at zero. It is not profit and excludes commissions, slippage and broker fills.
- A stop touch halts further observations. A gap longer than the provider's allowed interval changes state to `gap` and halts evaluation; missing touches are not inferred. Source changes do not repair the gap.
- Observed target levels cannot be rewritten by later edits. Gap/stopped price edits are rejected. Ordinary quote updates do not invalidate a manual edit version; row locks and immutable observed levels still protect concurrent operations.
- The signal remains administratively active until an administrator closes it. Observation never sets a win/loss/break-even outcome, never executes a trade and never populates verified performance. Broker/cost-aware outcome accounting remains outstanding.

Sparse snapshots can miss intragap/intratick behavior even below the chosen gap threshold. Production acceptance must assess quote cadence, clock accuracy, market sessions and suitability before relying on observations. Historical backfill and gap recovery are not implemented.

## Calendar notifications and jobs

After importing calendar events the CLI queues high-impact releases due within 30 minutes. Run `npm run calendar:queue` from a trusted scheduler at least once per minute to catch events imported earlier. This scheduler is separate from the push worker and is not deployed automatically.

A first actual value creates a `news.released` event only for a release within the last hour. Revision updates do not create duplicate release events. Upcoming keys include scheduled time; a reschedule invalidates delivery of the old upcoming event. Recipient checks suppress disabled/unlicensed providers and respect the member's news preference. Generic notifications link to the calendar record; push text never includes licensed release values. Source revisions and outbox records are stored transactionally. Normal clients cannot invoke import, reconciliation or queue scheduler functions.

## Acceptance still required

Connect a real licensed provider using confirmed API mappings, import source quotes/releases, test auth/display rights with real Supabase sessions, compare source and stored timestamps, exercise actual gaps/replays/revisions and validate physical-device news/target delivery. Test live cadence and scheduled worker deployment. Do not call the feeds connected or performance verified until these checks succeed.

## Sources identified by the project owner

The owner has TradingView, Forex Factory and Investing.com accounts. TradingView is supported as an alert source through the Phase 2 authenticated webhook. A website account or chart subscription does not establish API or calendar redistribution rights. Forex Factory and Investing.com are therefore recorded as source preferences, not connected feeds. Confirm an authorized machine-readable API/export and its applicable license before writing an adapter or displaying their economic figures. Trading Economics remains an optional licensed-calendar alternative, not an existing account or an active integration.
