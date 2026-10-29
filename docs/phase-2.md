# Phase 2 implementation notes

The ingestion path is HTTPS route → validated/authenticated alert → service-only PostgreSQL RPC → pending signal → administrator approval → audited outbox event. It never executes trades. Only the service client holds the Supabase service key; ordinary pages continue using session-bound Supabase clients and database policies.

Administrators can revise open signals with an optimistic version check and a mandatory reason. Published entry, direction and audience cannot change. Active stop/target/reasoning changes create a distinct notification event and preserve before/after values in the audit. Closed records cannot reopen or be revised. Publishing an announcement is similarly audited and creates one event. Normal clients have no mutation grants for those tables.

The worker first prepares eligible event/device rows, then claims bounded batches with `FOR UPDATE SKIP LOCKED`, an expiring lease and an opaque claim token. Only the matching live lease can finalize a row. Failed transient sends move back to pending with a future retry time; exhausted attempts become failed. Expired devices become inactive. Event aggregation completes only after its deliveries reach terminal states; zero-recipient events complete without claiming a device delivery.

Preference and entitlement checks run at fanout, claim and immediately before the network request. Notifications intentionally contain generic text so a revocation racing an in-flight send does not reveal premium content. The database remains the authority when a member opens the page. Device deduplication is best effort, with 30-day retention; it does not establish exactly-once delivery.

Automated validation includes the actual migrations running in PGlite PostgreSQL with mock `auth.uid`/`auth.role`, application rule tests and Chromium demo checks. PGlite is development-only and never replaces Supabase in production. Live Supabase Auth/PostgREST/realtime behavior, real TradingView delivery and physical-device push still require staging acceptance.
