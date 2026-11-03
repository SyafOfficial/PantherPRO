# Independent tick-volume momentum technique

Status: shadow observations only; no client signal, push notification, order, stop or target is created by this technique.

The owner worker scans this technique independently of QM, BOS, CHOCH, trendlines, higher-timeframe alignment, Daily availability and the owner's session filter. It reports `tickVolume` alongside the existing owner-cycle result. Existing signal publication behavior is unchanged.

Provisional v1 conventions:

- Latest completed M5 candle, with its close less than 300 broker-server seconds old.
- Twenty contiguous preceding M5 candles form the baseline; the signal candle is excluded.
- Every baseline candle must have positive tick volume. Missing/zero history withholds the decision.
- Signal tick volume must be at least 1.5 times baseline mean.
- Body must occupy at least 60% of candle range.
- BUY requires bullish body and close within the upper 20% of range; SELL mirrors this.
- Otherwise WAIT with an explicit reason. Fresh snapshot and quote are mandatory.
- Candidate identity includes technique version, symbol, timeframe, candle close and direction. Repeated snapshots of one candle retain the same identity. Logs are observations, not durable notification deduplication.

Tick volume measures broker quote activity; it does not identify actual aggressive buy/sell trade volume or establish a probability of profit. Signal reference close is not an executable fill. Thresholds are initial hypotheses, not validated trading performance.

The current worker checks its owner cycle about once per minute, not on every tick. Next steps before enabling client publication: evaluate historical and forward results, choose explicit entry validity/SL/TP rules for this independent technique, store candidates and lifecycle events with durable deduplication, and verify notification fanout. Do not treat the technique as production signals yet.
