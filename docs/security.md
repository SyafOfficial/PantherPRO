# Security review status

Implemented and locally tested:

- Server-verified Supabase sessions, same-origin browser mutation checks and server-side admin gates.
- Default public membership, column-level denial of role escalation, VIP RLS and no direct client lifecycle updates.
- Actual SQL migrations and policies exercised in local PostgreSQL/PGlite with mock Supabase Auth identities. Tests include public/VIP/admin isolation, anonymous denial, approval requirements, immutable client audit access and stale revision rejection.
- Strict webhook schema, 8 KiB streamed-body bounds, constant-length authentication digest comparison, ±5-minute freshness, canonical duplicate/conflict detection and service-only ingestion RPC.
- Transactional audit records, serialized accepted-alert/admin creation limits, row-locked lifecycle transitions and optimistic revisions. Published entry/direction/audience cannot change.
- Protected device registration, preference RLS, capped device registrations, personal test rate limits and no direct subscription mutation grants.
- Push-service hostname allowlist, no credential-bearing URLs/custom ports/private endpoints, generic push content, current membership/preference checks and no provider error-body logging.
- Unique event/device deliveries, expiring leases/tokens, bounded retries, inactive expired devices and retained delivery history. Browser stable-tag/IndexedDB deduplication is best effort.
- Frame denial, content-type protection, restrictive connection destinations and no sensitive offline caching.
- Demo controls fail closed; integration health never treats configured credentials as verified connectivity.

Required before production:

- Apply all migrations to staging. Repeat policy, RPC and concurrency tests using real Supabase Auth/PostgREST/realtime sessions; local mocks do not establish that deployment's readiness.
- Enable Auth email confirmation, SMTP, appropriate Auth rate limits/anti-bot protection and strong passwords. Complete password recovery UI and admin MFA enrollment/enforcement.
- Add edge/distributed limits for unauthenticated webhook/API attempts. Database limits bound accepted writes, not all incoming traffic. Set request deadlines/body limits at the HTTPS edge and disable request-body logging for authenticated alert payloads.
- Consider independent second-admin approval; currently one administrator can draft and approve. Review service-role access and secret rotation procedures.
- Run a real TradingView staging alert and physical-device push tests. Verify worker restart, lease expiry, retries, account switching/signout, permission revocation, category suppression and membership revocation.
- Treat `delivered` as provider acceptance only. A crash between provider acceptance and acknowledgment may retry; no exactly-once guarantee is made.
- Connect licensed quotes/calendar and reconcile provenance before claiming TP hits, SL outcomes or performance. Manual closure alone produces no verified result.
- Complete dependency auditing, deployed penetration tests, backup/restore drills, privacy/deletion/retention policies and operational monitoring.
- Tighten inline script CSP with nonces and add HSTS at the HTTPS edge. Extend chart/provider origins only after selecting authorized integrations.
- Validate HTTPS install and notification behavior on physical iOS/Android/desktop devices.

All service, VAPID private and webhook secrets must remain server-side. Never put them in `NEXT_PUBLIC_` variables, client metadata, URLs, source files or logs. Bootstrap admins only in a trusted database operation. No automated trade execution or payment provider is active.

Phase 3 adds source registration gates (disabled by default), service-only normalized data ingestion, finite-price constraints, chronological/freshness checks, explicit admin-started quote observations, gap/stop halting, immutable observed targets, attributed calendar revision history and suppression of obsolete/rescheduled news. These are locally tested against PostgreSQL; they do not establish an actual license, real provider mapping, broker execution or verified performance.

Phase 4 adds separately approved analysis rights, a bounded session-authorized input RPC, no-store report responses, source/freshness/gap checks and a strict model-draft contract. Rule-based analysis and any future model draft have no signal-write capability. Citation/schema checks do not establish model truthfulness; a real adapter, editorial workflow, rate/cost controls and provider quality tests remain outstanding.
