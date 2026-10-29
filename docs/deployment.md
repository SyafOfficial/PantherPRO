# Deployment and environment operations

Deploy Next.js to a Node-capable provider (for example Vercel or a container host), using Node 22+ with `npm ci`, `npm run build`, then `npm start`. Deploy `npm run push:worker` as a separate persistent service for push delivery; run `npm run calendar:queue` from a trusted once-per-minute scheduler for upcoming news. The licensed-data import boundary exists, but vendor-specific continuous feed adapters and historical backfill remain future work. do not run long-lived workers in request handlers or assume cron is already configured.

Set the two Supabase public variables at build and runtime. Next.js embeds `NEXT_PUBLIC_` values in the browser bundle, so rebuild after changing them. All service-role, VAPID private, webhook, future AI and licensed-data credentials belong in server-only provider settings. The webhook and worker use a server-only service-role key; ordinary member pages use session-bound clients. Keep staging and production databases separate.

Before release: apply all migrations, set Auth Site URL and redirects, configure SMTP/confirmation/rate limits, bootstrap a verified administrator, and perform the connected-account checks in README. Use HTTPS for cookies, PWA and push. Confirm security headers with the provider's proxy. Add HSTS at the HTTPS edge; the application supplies a per-request nonce-based script CSP; verify it remains intact through the hosting proxy.

`/api/health` checks application availability and declares integration status only. It is not a database connectivity/readiness probe. Monitor database queries, Auth failures and queue growth separately. No claim of deployment or fresh-task restoration is made by a local build.

Snapshot dependencies and source through the cloud environment publication flow. Processes are not retained. Future tasks should use the existing `/workspace/PantherPRO` checkout, run `npm ci` if dependencies need refreshing, then start the desired server. Never create a worktree by default.

Production acceptance requires: real Supabase role-policy tests, email confirmation and recovery, session refresh/signout, provider licensing, observed webhook retries and replay rejection, physical-device push tests, backup/restore and incident procedures, and verified price provenance before performance reporting.

## Supabase initial setup

The app accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or, as a fallback, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copy the complete public key from the same Supabase project as the URL. A successful service-role check does not validate the separate public key.

For a new dedicated empty project, `supabase/setup.sql` combines migrations 001–008 into one transaction for the Supabase SQL Editor. Apply it once, or use the individual migrations with the Supabase CLI; do not apply both. A service-role Data API key cannot execute arbitrary schema migrations. Database setup requires SQL Editor access, a database connection, or a Supabase management connection. After setup, the service-only `deployment_readiness()` function must report schema version 8.

The Render blueprint is prepared but has not been deployed. It includes paid service plans; review costs before creating resources. Website publication, real Auth/email/MFA, licensed provider feeds and physical phone push delivery still require connected validation.

On Render, the app uses the platform-provided `RENDER_EXTERNAL_URL` when `APP_ORIGIN` is unset. An explicit `APP_ORIGIN` takes precedence for a custom domain. Both use the same canonical HTTPS validation; request headers cannot supply the production origin.
