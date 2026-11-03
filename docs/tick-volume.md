# Independent tick-volume momentum technique

Status: shadow observations with structural SL/TP; no client signal, push notification or order is created by this technique.

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

The current worker checks its owner cycle about once per minute, not on every tick. SL uses the nearest intact confirmed support below a BUY entry or resistance above a SELL entry. TP1–TP3 use the nearest three distinct intact confirmed opposing levels across M5/M15/M30, sorted by distance. Confirmation uses two candles on each side of a swing; no future candles are allowed. Levels swept after confirmation are discarded. Entry reference uses current ask for BUY and bid for SELL. Missing stop or three distinct targets yields `withheld_missing_roadblocks` and no entry. No fixed TP distances or artificial levels are generated.

Next steps before enabling client publication: evaluate historical and forward results, implement explicit entry validity and lifecycle processing, store candidates and lifecycle events with durable deduplication, and verify notification fanout. Existing database publication accepts only structural v1 metadata and must be extended deliberately; this code does not relabel tick volume as QM/BOS/CHOCH. Do not treat the technique as production signals yet.
