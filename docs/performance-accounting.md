# Admin Signal Performance

`/admin/performance` requires an administrator profile and MFA (`aal2`). The ledger has matching RLS; the reporting RPC independently checks both. Clients receive only aggregate active/session counts, never the private ledger. Clients cannot edit signals.

## Accounting

- XAUUSD pip size: 0.10. BUY pips = (target − published entry) / 0.10; SELL reverses the subtraction.
- Count the highest TP hit once per signal. TP3 replaces TP2/TP1; do not add them together.
- Any TP = Win, including a signal that later hits SL. Such SL events remain counted in SL Hits but incur no extra pips deduction, per owner policy.
- SL without any TP = Loss, deduct the published stop distance. This is planned signal pips, not the M5 close execution price or account P/L.
- A BE management instruction (`signal.break_even`) gives an active signal a provisional +50 if there is no TP/SL/BE exit. It is not a Win.
- TP replaces the provisional +50. SL replaces it with the loss. Actual BE return (`signal.be_hit`) replaces it with zero. Manual closure without outcome removes it and remains Unclassified.
- BE exits are separate. Win Rate = Wins / (Wins + Losses), excluding BE, running, active and unclassified signals.
- No lot sizes, commissions, slippage or broker fills are modeled. Total Signal Pips includes explicitly labeled provisional running pips.
- Monitoring gaps are shown. Unknown outcomes are not converted into losses or BE.

Published entry and achieved target/stop prices are preserved. Capture occurs on publication, revisions and milestones, not every market movement. Ledger rows survive the scheduled 30-day source-signal cleanup (source FK becomes null). Backfill includes only still-existing published signals and remaining alert records; deleted history cannot be reconstructed.

## Time And Access

Client Signals Today counts publication times in the owner-defined MYT window 06:00 inclusive to next-day 05:30 exclusive. Between 05:30 and 06:00 it shows zero. This is a 23.5-hour counting session, independent of broker opening hours/DST. Reset affects the count only; active signals continue until closed. Server time and elapsed monotonic browser time drive reset, followed by a refresh at each boundary.

Admin filters use inclusive MYT calendar dates, at most 366 days. Aggregates include the entire filtered range; detail display is limited to the latest 200. Existing active client list shows the latest 50, while active/session totals are uncapped database aggregates. Admin page refreshes every 15 seconds while visible.
