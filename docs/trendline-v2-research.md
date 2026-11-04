# Trendline V2: Bounce and Breakout + Retest

Status: live team-pilot implementation, authorized by the owner. The pure detector
and snapshot CLI remain usable offline; `lib/engine/trendline-live.ts` adapts the
proposals to the existing publication protocol. `automaticEngineCycle` selects
this adapter in production. Synthetic tests establish rule behavior, not trading
profitability. Historical performance has not been validated.

## What was found

The production detector in `lib/engine/automatic.ts` selects the last two confirmed
directional pivots and accepts a third-touch directional candle. It does not
reject all earlier closes through that same line. Subsequent invalidation checks
compare with a fixed projected price rather than projecting the line at each
candle. The shared stop builder uses the M5 zone plus a fixed buffer.

The retained database sample inspected on 4 November 2026 contained two TRENDLINE
signals, both with a stop timestamp, neither with TP1, one with a BE instruction.
That BE instruction is not evidence of a completed break-even exit or broker fill.
These two records cannot establish a reliable loss rate or the cause of each loss.

## Separate detection rules

Common requirements:

- Two confirmed swing pivots, separated by at least five setup bars. Pivots require
  two later bars to confirm; the event candle cannot confirm its own anchors.
- Rising lows define support; falling highs define resistance. All closes between
  the first anchor and the event must have respected the same projected line.
- Line value is recalculated using each candle's broker opening timestamp.
- Direction must match known higher-timeframe structure. Unknown/range context
  produces no proposal.
- Event rejection/displacement closes in the outer 35% of its candle and has a
  directional body of at least 0.35 prior ATR(14).

**Bounce:** a third-touch setup candle rejects an intact rising support line for
BUY or falling resistance line for SELL.

**Breakout + Retest:** a third touch must already exist before the breakout. A
setup candle closes beyond the opposing line, with the previous candle on the
original side. A wick alone is insufficient. The later M5 retest must hold the
new side of the line.

For both modes, a separate completed M5 candle must touch the projected line,
close away from it, have a directional body of at least 0.25 prior M5 ATR(14), and
close beyond the previous M5 candle's high/low. An intervening close on the wrong
side invalidates the setup. No confirmation is reused before the event closes.

## Price and risk rules

These are provisional research parameters, not optimized constants:

- Line tolerance: max(0.10 setup ATR, current spread, two price points).
- Maximum slope: 0.50 setup ATR per setup bar.
- Maximum event age: three setup periods; M5 confirmation no more than five
  minutes old. Both timings are checked using broker wall-time coordinates.
- Spread must not exceed 25% of prior M5 ATR. Entry remains inside the completed
  M5 rejection candle; no chasing. The existing 80-pip maximum zone width is retained.
- Bounce stop: beyond the second structural anchor and M5 retest extreme.
- Breakout stop: beyond the breakout candle and M5 retest extreme.
- Stop buffer: max(0.15 setup ATR, twice spread, two price points). Stops are
  rounded outward to the symbol price point, matching executable quote precision.
- The nearest intact target is supplied by the existing structural target
  detector. Minimum reward/risk is 1.5 measured from the least favorable zone
  edge. Targets are never moved farther away just to pass this filter.

The snapshot adapter supports M15, M30, H1, H4 and W1, with the next timeframe as
context (calendar MN1 for W1). MN1 setup detection itself is intentionally absent
until its variable-period expiry rules have been validated. Existing real
ask-side M5 evidence is still required for SELL proposals. This preview does not
change the owner's completed-M5-close SL policy, TP/BE touch policy or 50-pip
management instruction.

## Run the preview

From the repository root:

```sh
node --import tsx scripts/preview-trendline.ts path/to/vestrado-snapshot.json
node --import tsx tests/trendline-preview.test.ts
```

The CLI assesses a saved snapshot at its original export time. It prints research
proposals only. It does not connect to a database, publish signals, send push
notifications or place orders. Do not commit market captures or credentials.

A saved production snapshot exported at 2026-11-04 13:45:25 UTC was processed
successfully and produced zero eligible proposals. This is a format/integration
check, not a backtest and not a measure of accuracy.

## Live pilot and remaining evaluation

Replay timestamped, unseen Bid/Ask ticks and completed candles across different
market regimes, retaining the historical higher-timeframe context available at
each decision. Evaluate Bounce and Breakout + Retest separately. Include spread,
entry timing, the completed-M5-close SL rule, TP touches, BE instruction and zone
return as distinct events. Do not treat a BE instruction as an exited position.

Record signal count, TP-before-SL ordering, ambiguous/missing-data intervals,
drawdown and sensitivity to each provisional threshold. Hold out time periods
from parameter selection. Compare both subtypes against the prior detector when sufficient data is available. One current snapshot and two historical signal records are insufficient to
approve performance or claim fewer losses.

Live integration stores subtype and anchor evidence in the publication audit.
The server independently recomputes the V2 structural stop from the accepted
snapshot and requires at least 1.5 reward/risk to the nearest target. Other
strategies retain the prior fixed-buffer contract. A stable versioned identity
permits one publication per anchored line, subtype and direction. New publication
still uses the existing approved engine policy; monitoring and notification
queues retain their current rules. No model parameters are changed on open signals.

Rollback: restore the previous worker commit. The additive database validator
continues to accept the prior protocol, and existing signals keep their stored
levels. Do not delete evidence or send fabricated signals to test the pilot.
