# Formula Backup v1

Saved baseline for PantherPRO's deployed strategy behavior.

- Live source commit: `08557f10f1d8087397b2cdb2d1ca347bbdb9541b`
- Source branch at capture: `codex/mt5-engine-rules`
- Captured UTC: 2026-11-05 04:04:37 UTC
- Live Render web and worker were both verified on that source commit.

## Coverage

The complete repository source at this branch includes QM, BOS, CHOCH,
Trendline Bounce, Trendline Breakout + Retest, tick-volume momentum, MT5
exporter/uploader source, strategy tests and database migration history.
The production entrypoint is `lib/engine/service.ts` calling
`scanLiveAutomatic` in `lib/engine/trendline-live.ts`. Restore the complete
compatible engine implementation; the legacy trendline detector retained inside
`automatic.ts` alone is not the deployed V2 strategy.

- `source-rules.json`: numerical constants captured from the source modules.
- `database-reference.json`: runtime strategy-policy settings, signal constraints,
  applied migration identities and function execution permissions.
- `restore-functions.sql`: five live database function definitions and execution
  permissions, including buffered SL/TP/BE monitoring and V2 structural-stop checks.
- `manifest.json`: baseline identifiers and SHA-256 checksums.

Source defaults and live policy state are recorded separately. In particular,
the source's `autoPublish: false` default is not the enabled database policy.

SL uses an inclusive completed M5 close (BUY: Bid; SELL: actual Ask evidence).
TP1–TP3 and BE management use the existing inclusive quote-touch rules.
A 50-pip BE instruction and an eventual return to the entry zone are separate
events. Existing entry/target prices, deduplication identities and monitoring
records are retained when restoring function definitions.

## Restore procedure

1. Read `manifest.json` and review the issue against the saved source. Keep the
   current commit and database function definitions as a new safety checkpoint.
2. Pause new automatic publication using the existing MFA-protected admin
   control. Existing signal monitoring continues under that control.
3. Restore the relevant engine source from the live source commit above into
   a new review branch, or use the complete saved source when a full application
   rollback is required. Review compatibility with later schema/application changes.
4. Compare the current schema with `database-reference.json` and the saved
   migrations. Apply `restore-functions.sql` as the database owner only when
   those table/column contracts remain compatible. The script restores function
   definitions and execution privileges; it does not restore or delete table rows.
   The constraint definitions and policy values are reference data, not an
   instruction to overwrite newer records or automatically enable publication.
5. Run the relevant strategy/database tests, typecheck, formatting, build and
   browser checks. Deploy the reviewed commit and verify the exact deployed
   source on both Render services.
6. Confirm fresh snapshots, existing monitoring, target/BE notifications and
   duplicate prevention. Resume new publication intentionally after those checks.

Avoid replaying old signal candidates or reverting user/signal/outbox/audit data.
Existing signal levels must be handled deliberately rather than recalculated
using a newly restored entry formula.

## Verification and storage

The restore SQL was executed against an isolated PGlite database built from the
baseline migrations. All five functions compiled, captured execution privileges
matched, and no account/signal rows were inserted. The local scheduler registration
was stubbed because PGlite has no pg_cron worker. No production rollback was run.

The snapshot contains source, schema/function reference and strategy settings.
Protected Render/Supabase credentials remain in provider settings. Customer data,
passwords, API keys, VPS binaries and external account configuration are excluded.

Keep this backup branch and its commit. The commit SHA is the exact checkpoint;
a branch name can be moved or deleted by a repository maintainer.
