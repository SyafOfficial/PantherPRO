# Engine rules and MT5 Vestrado integration

## Current implementation

`lib/engine/rules.ts` is a deterministic, provider-independent rules module. It does not connect to MT5, detect swing structures automatically, publish signals, send push or place trades. Candidates explicitly require review. Method labels (QM/BOS/CHOCH/trendline), zones, breakout levels and structural targets must currently be supplied by an upstream detector/reviewer. Backtesting and performance validation are outstanding.

The latest owner instruction selects setup frames M15, M30, H1, H4, W1 and MN1 only. M5 is reserved for confirmation, roadblocks and stop invalidation. Daily is excluded from new setups; existing daily database records remain readable. Monthly uses calendar candles from the feed, not a fixed 31-day resampling; the minute ranking is only for hierarchy comparison.

A completed breakout must close beyond the left breakout level. A later, completed M5 candle must touch the zone and close strictly back on the valid side. Equality does not confirm entry. Candle geometry, chronology and confirmation freshness are checked. This encodes retest validation; it does not yet discover the correct left candle or all market structure.

`pipSize` is mandatory per broker symbol: there is no silent pip default and no lot/profit calculation. Proposed 0.10-price pips still require confirmation against the owner's Vestrado convention. Maximum entry-zone width is 80 pips and the configured SL buffer is at most 30 pips outside the zone. That buffer does not cap total loss from entry. BUY invalidation is below the zone; SELL invalidation is above it.

TP1 and TP2 use the nearest two distinct supplied confirmed M5/M15/M30 roadblocks, ahead of the entire entry zone and before the supplied setup-timeframe target. TP3 uses that higher target. Fewer than two roadblocks means no candidate, rather than invented R multiples. Structure detection and full provenance validation remain upstream work.

The monitor creates stable event IDs. It observes BUY exits on bid and SELL exits on ask. TP levels use quotes. Strictly more than 50 favorable pips from the conservative entry-zone edge emits `Close Partial and SET Break Even now!` once in the supplied state. No execution or lot size is inferred. Only an explicitly completed M5 exit-side candle closing strictly beyond SL creates an SL event. A wick beyond SL with close holding produces a possible sweep observation, not guaranteed reversal. Quotes and candle-close observations at the same timestamp are tracked separately.

Events describe hypothetical observations. Broker fills, profits and automatic partial closure/BE changes are not claimed. The actual hard stop in MT5 can execute on a wick and differ from the app's close-based invalidation. Monitoring state and events must be committed transactionally before connecting this module to the existing push outbox. Missing observations, reconnect backfill, market sessions and multi-process locking still need implementation; the monitor cannot claim complete intrabar history.

## MT5 Vestrado source

The owner uses MetaTrader 5 with Vestrado. The intended integration is a read-only EA/terminal bridge on an always-on Windows PC/VPS, sending normalized candles and bid/ask ticks to a separately authenticated ingestion endpoint. Never send broker passwords to the app, chat or GitHub. Render hosts the web app; it does not run a Windows MT5 terminal. No terminal connection or VPS is configured yet.

First confirm exact broker symbol name (including suffix), digits, point size and session/calendar boundaries from the owner's terminal. M5 chart candles are commonly bid-based; SELL invalidation requires actual ask-side evidence or must remain unavailable, rather than inventing historical ask candles from the current spread.

Tick volume counts feed activity. It does not establish aggressive buy/sell volume. Buy/sell imbalance needs genuinely classified transactions; order-book depth needs broker-supported DOM subscription. If Vestrado does not provide either, report unavailable. Do not synthesize an imbalance from green/red candles or label broker depth as global gold liquidity. A direction filter and thresholds still require definition and testing. Confirm broker terms for derived signals and any redistribution to clients.

## Database rollout

Migration `202610300009_engine_timeframes.sql` is additive to the existing live schema. Apply only migration 009 to the existing project; do not rerun initial `setup.sql`. It adds M15/MN1 and restricts new D1 assignments, preserving historical daily rows. App selections must be deployed after this migration. The old quote reconciler still implements its earlier touch-based observation semantics: do not connect it to these close-based engine signals until the two paths are explicitly reconciled.
