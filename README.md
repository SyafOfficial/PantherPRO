# PANTHER FX INTELLIGENCE

A mobile-first gold intelligence terminal built with Next.js App Router, TypeScript, React and Supabase. Obsidian surfaces, champagne details and restrained intelligence accents create a private financial workspace.

## Current scope

Phases 1–4 development foundation: seven client sections, responsive navigation, a separate administration workspace, Supabase email/password authentication, role-based database authorization, manual signal drafts and approval, membership management, audit logs, authenticated TradingView ingestion, optimistic signal revisions, member announcements, notification settings, a retrying Web Push worker, licensed-data import gates, quote observation, calendar revisions, source-backed technical/news analysis, PWA manifest, icons and an offline fallback. Styling uses custom CSS tokens rather than Tailwind; no UI service or font connection is required.

**Demo is read-only.** The example signal and chart are fictional, dated fixtures. There is no live market connection and no verified performance. Connecting Supabase removes all demo signals and chart data; it never fills a failed live query with fixtures. Anonymous visitors cannot read database signals. Authenticated public members see public published content; VIP and administrator members can access VIP content.

TradingView, market prices, the economic calendar, AI, push delivery and payments are **not connected**. The health endpoint reports this explicitly. This is a development foundation, not a production trading service. It never executes trades.

## Local setup

Requirements: Node.js 22+ (validated here with 24), npm, Git. Use the existing checkout; cloud tasks are already isolated and do not need a separate worktree.

```sh
cd /workspace/PantherPRO
npm ci
cp .env.example .env.local  # only if .env.local does not already exist
npm run dev
```

No environment variables are needed for demo mode. For a production build use `npm run build` then `npm start`. Check `/api/health` for application availability; it does not validate external providers. The optional push worker and calendar scheduler run separately; it is never started automatically without credentials.

### Connect Supabase

1. Create a Supabase project; apply all SQL files in `supabase/migrations/` in filename order using the SQL editor, or link the Supabase CLI and use `supabase db push`. The migrations expect Supabase's auth schema and realtime publication, not a plain PostgreSQL database. Apply each once; existing Phase 1 projects need only the additional migrations.
2. Put the project URL and publishable key in `.env.local` using the names in `.env.example`. These are public application identifiers. Never use a service-role key in a `NEXT_PUBLIC_` variable.
3. Set the Auth Site URL to the deployment's HTTPS origin, configure your redirect allowlist for `/auth/callback`, enable email confirmation, set a minimum 12-character password, configure SMTP and appropriate Auth rate limits. Password recovery and MFA enrollment UI remain production-hardening work.
4. Restart Next.js. Sign up, confirm the email, then sign in. Accounts start with public access regardless of supplied user metadata.
5. Bootstrap the first admin in the trusted SQL editor: `update public.profiles set role = 'admin' where id = '<verified-auth-user-uuid>';`. Confirm the user's identity before running this. Never grant admin using client metadata. Subsequent admin grants also require a privileged database operation.
6. Open `/admin`. Create a draft with ordered targets and a stop on the correct side of entry, submit for review, then approve and publish. Review is mandatory, but a different second approver is not yet required. Public clients cannot read drafts or pending review records. No market checks validate the administrator's price assumptions yet.
7. Sign in as a separate public member and VIP member. Verify VIP visibility and admin denial. Database policies are the authorization boundary; client role helper tests are not a substitute for deployed RLS tests.

Realtime subscribes to authorized signal changes; a 60-second refresh also rechecks current access. Subscription delivery, signup, role policies and approval RPCs require a real Supabase project and have not been validated in this demo environment.

## Webhooks and push

See [integration setup and acceptance tests](docs/integrations.md) and [Phase 2 architecture](docs/phase-2.md). Configure the server-only service key and webhook secret for ingestion; configure VAPID keys and run `npm run push:worker` separately for delivery. Use `/account` for saved preferences, device registration and a personal test, and `/admin` for delivery logs and announcements. No external credentials or deliveries have been verified here.

## Phone app and trading-method focus

Open `/install` for iPhone/Android installation guidance, then `/account` for device registration and notification preferences. A real HTTPS deployment and configured push worker are required for live phone notifications; no public deployment or physical-device delivery has been verified here. There is no daily signal quota.

Signals support QM, BOS, CHOCH and trendline tags, M30/H1/H4/D1/W1 setup timeframes and strictly higher optional context. Apply migration 006 after 001–005. Tags are not automated detections; automated method rules must be explicitly configured before activation. XAUUSD news coverage now includes Fed rates/FOMC, NFP, CPI, PPI and PMI. See [phone, setups and news](docs/phone-and-setups.md).

## Validation

```sh
npm test             # PostgreSQL/RLS, signal, webhook and push rule tests
npm run typecheck
npm run build
npm run test:e2e     # Chromium; uses a production build, starts its own server
```

Browser tests expect demo mode and an available Chromium binary at `/usr/bin/chromium`; override `CHROMIUM_PATH` for another installation. In CI install Chromium with Playwright and configure the executable path. Do not run demo assertions against a configured live workspace. Tests cover desktop/phone navigation, no horizontal overflow at 390px, fictional-data labels, empty performance, disabled demo writes, account pages, health, and PWA resources.

PWA metadata and service worker are included. Only navigations have an offline fallback; authenticated pages and market data are never cached. Actual Add to Home Screen on iOS/Android, HTTPS installation and physical-device behavior remain deployment acceptance checks. The service worker has generic push display, safe deep links and best-effort stable-ID deduplication; actual delivery requires keys, the worker and a supported device.

## Architecture and implementation phases

- **Phase 1 (implemented):** Next.js server pages/actions, React terminal, Supabase SSR sessions, PostgreSQL RLS, protected admin actions, manual review workflow, audit records, queue foundation and demo mode.
- **Phase 2 (implemented locally; external acceptance pending):** authenticated/idempotent TradingView route, source validation, audited versioned edits, announcement controls, saved notification preferences, device registration, push outbox/leases/retries and worker. Real TradingView and device-delivery acceptance remain outstanding.
- **Phase 3 (local infrastructure implemented; vendor connection pending):** normalized licensed-data import, provider permission gates, timestamped bid/ask observations, gap detection, target/stop observations, calendar revisions and news queuing. Vendor-specific adapters, continuous feeds, historical backfill and verified performance remain outstanding.
- **Phase 4 (local rules and model boundary implemented; AI provider pending):** source-backed technical analysis, conditional pre-news scenarios, post-news comparisons, evidence timestamps and explicit insufficient-data handling. Optional model drafts are schema/digest/citation-bound and unreviewed; no model API, editorial workflow or generated output is connected. Signal approval remains independent.
- **Phase 5:** deployed RLS tests, abuse tests, MFA/recovery, monitoring, backups, full performance accounting, HTTPS PWA and real-device push tests, production deployment.

See [intelligence methods](docs/phase-4.md), [licensed data and reconciliation](docs/phase-3.md), [deployment](docs/deployment.md), [integration contracts and testing](docs/integrations.md), and [security checklist](docs/security.md). No payments or provider account has been activated.

## Source layout

`app/` contains the terminal, auth, admin and health routes. `components/terminal.tsx` provides the client workspace. `lib/` contains server-only session access and signal validation. `supabase/migrations/` owns the database boundary. `scripts/` contains the worker and secure local key generators. `tests/` includes the actual SQL running in local PostgreSQL/PGlite with mocked Auth roles, plus application and browser checks.

Financial risk: leveraged trading can cause loss of all capital. This application provides educational information, not personal financial advice or guaranteed outcomes.
