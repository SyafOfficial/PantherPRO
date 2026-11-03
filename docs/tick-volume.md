# Independent tick-volume momentum technique

Status: policy-controlled automatic VIP signal publication with structural SL/TP. No broker order is placed.

The automatic worker scans this technique independently of QM, BOS, CHOCH, trendlines, higher-timeframe alignment, Daily availability and the owner's session filter. The owner cycle also reports observations. Automatic publication uses a separate tick policy and the existing master pause control. Structural v1 publication remains unchanged.

Initial v1 rules:

- Latest completed M5 candle, with its close less than 300 broker-server seconds old.
- Twenty contiguous preceding M5 candles form the baseline; the signal candle is excluded.
- Every baseline candle must have positive tick volume. Missing/zero history withholds the decision.
- Signal tick volume must be at least 1.5 times baseline mean.
- Body must occupy at least 60% of candle range.
- BUY requires bullish body and close within the upper 20% of range; SELL mirrors this.
- Otherwise WAIT with an explicit reason. Fresh snapshot and quote are mandatory.
- Candidate identity includes technique version, symbol, timeframe, candle close and direction. Repeated snapshots of one candle retain the same identity. Published candidates are durably deduplicated by source event identity.

Tick volume measures broker quote activity; it does not identify actual aggressive buy/sell trade volume or establish a probability of profit. Signal reference close is not an executable fill. Thresholds are initial hypotheses, not validated trading performance.

The automatic cycle checks each fresh uploaded snapshot; owner diagnostics run about once per minute. SL uses M5/M15/M30 levels: the nearest intact confirmed support below a BUY entry or resistance above a SELL entry. TP1–TP3 use the nearest three distinct intact confirmed opposing levels across M30/H1/H4, sorted by distance. Confirmation uses two candles on each side of a swing; no future candles are allowed. Levels swept after confirmation are discarded. Entry reference uses current ask for BUY and bid for SELL. Missing stop or three distinct targets yields `withheld_missing_roadblocks` and no entry. No fixed TP distances or artificial levels are generated.

Publication revalidates the volume, candle, fresh quote and structural levels in the database. SELL also requires actual exit-side ask M5 evidence. Signals use the existing lifecycle monitor for target observations, M5-close stop observations and gap handling; events enter the durable VIP notification outbox exactly once. Public accounts cannot see these signals. Vestrado IB/deposit eligibility remains an administrative membership check, not an automatic broker integration.

Policy is disabled by default in the migration and enabled only after deployment verification. The master automatic-engine pause stops new publications while continuing existing signal monitoring. Initial thresholds have not established historical or forward profitability.

Owner correction on 4 November 2026 MYT: M5/M15 levels are not TP sources. BUY targets are M30/H1/H4 resistance above entry; SELL targets are M30/H1/H4 support below entry. The three nearest distinct intact levels are selected, including H4 where present. No artificial minimum pip distance is imposed. XAUUSD price distance $1 = 10 pips: 3905→3906 = 10; 3905→3910 = 50.
