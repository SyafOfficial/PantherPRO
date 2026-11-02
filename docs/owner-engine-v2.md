# Owner strategy engine v2 — observation implementation

This supersedes the older engine description **only for the new owner shadow worker**. Existing automatic policy v1, public signals and push delivery are unchanged. Do not enable v1 expecting the November rules. Nothing here places orders or sends client notifications.

## Implemented owner rules

- Gold pip = 0.10 price; zone width 5.00–8.00; invalidation 2.00 outside zone.
- M30/H1/H4/D1/W1/MN1 setup scanning, M15 fallback if no primary candidate.
- Highest established higher-timeframe directional structure wins. Missing context withholds lower-frame candidates.
- BOS/CHOCH require completed setup-frame close through a confirmed swing; QM also emits wick-break monitor candidates. Wick-only QM cannot become entry-confirmed in this conservative observation version.
- Trendline directional bounce and opposing-line close-break/retest candidates.
- 50% retracement candidates alongside origin fresh-zone candidates. Midpoint freezes at the setup break candle's extreme; it does not move using future candles.
- M5 bullish/bearish rejection OR body engulfing; observed BUY ask / SELL bid must remain inside zone.
- TP1 = observed entry +/- 5.00; TP2/TP3 = next two distinct known opposing structural pivots beyond TP1. Missing targets withholds entry confirmation.
- 06:00 inclusive–03:00 exclusive Asia/Kuala_Lumpur; broker feed freshness is also required. Existing confirmed setups continue monitoring outside the entry session.
- Private TP1/2/3 and strict M5-close invalidation events, stable IDs, persisted state and transactional compare-and-swap updates. No client push fanout.

## Explicit provisional conventions and limits

Diagrams do not specify swing strength, wick/body ratio, zone edges or exact roadblock selection. Initial parameters: strict 2-left/2-right pivots; directional rejection wick >= 2x body; origin candle full range, widened inward to 5.00 when narrower, rejected when wider than 8.00; 50% zone is 5.00 wide centered on midpoint. Trendline zone is anchored on the projected line. Confirmed pivots are used only after their right-hand candles exist.

Only first M5 touch may confirm in this version. Already touched older candidates are discarded. It does not yet support delayed multi-candle confirmation, complete pre-break departure/freshness reconstruction, or M1 roadblocks. The owner's discretionary examples must be compared against output before relaxing these conservative conventions. News interpretation/real-time release adapters and public client notification integration remain separate unfinished work.

The private monitor uses broker wall-time coordinates for sequencing; exported UTC determines session time. SELL invalidation uses actual ask M5 history; without it, no synthetic candle is constructed. Historical tick gaps are not reconstructed; TP events mean **observed price reached a level**, not filled trades or verified performance. A TP and invalidation inside an unseen gap have unknown order; when supplied together the completed invalidation takes precedence. A broker hard stop may fire on a wick before close-based invalidation.

## Run

1. Deploy the updated backend snapshot validator before the exporter: old seven-frame bridge snapshots remain accepted; new snapshots add D1. Recompile an updated `.mq5` exporter in MetaEditor and validate on the cloud MT5 terminal. Compilation/terminal behavior have not been verified in this workspace.
2. Apply `202611020012_owner_shadow.sql` once to the existing Supabase project. Tables are service-only with RLS; no changes to public signal tables/outbox.
3. Use server environment `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not expose the latter to the browser.
4. `npm run engine:owner:scan` checks one fresh bridge export. `npm run engine:owner:worker` polls every 10 seconds. Run the latter as a separate cloud process; it must not depend on an open browser or the owner's laptop. It is not added automatically to Render or billed by this change.
5. Review private `owner_shadow_setups`, `owner_shadow_events` and worker logs. Test both directions, every method, first touch/freshness, data gaps and restarts with real examples before wiring public publication or notifications. At most 200 oldest active setups are monitored per pass in this prototype; add lifecycle expiry/pagination before scale.

Render settings, Supabase migrations, MT5 cloud installation, feed rights and physical-device notification delivery require connected production validation. No credentials were supplied here and no cloud services were purchased.

## Existing Render worker integration

The existing `push:worker` now also attempts an owner shadow cycle once per minute. This reuses its existing Supabase connection and adds no new Render service. If migration 012 is absent it logs `migration_required` and continues current push delivery. The standalone owner worker remains available for a separate, faster observation process. New `/api/ready` diagnostics report receipt/export ages and shadow-storage availability instead of a fixed disconnected market label. The old automatic policy remains separate and is not converted to owner-v2 publication.

Daily is appended after the original seven exporter frames to preserve existing weekly/monthly chart projections. Existing snapshots retain their original frame positions.
