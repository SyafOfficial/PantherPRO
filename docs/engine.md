# Engine rules and MT5 Vestrado integration

## Current implementation

`lib/engine/rules.ts` is a deterministic, provider-independent rules module. It does not connect to MT5, detect swing structures automatically, publish signals, send push or place trades. Candidates explicitly require review. Method labels (QM/BOS/CHOCH/trendline), zones, breakout levels and structural targets must currently be supplied by an upstream detector/reviewer. Backtesting and performance validation are outstanding.

The latest owner instruction selects setup frames M15, M30, H1, H4, W1 and MN1 only. M5 is reserved for confirmation, roadblocks and stop invalidation. Daily is excluded from new setups; existing daily database records remain readable. Monthly uses calendar candles from the feed, not a fixed 31-day resampling; the minute ranking is only for hierarchy comparison.

A completed breakout must close beyond the left breakout level. A later, completed M5 candle must touch the zone and close strictly back on the valid side. Equality does not confirm entry. Candle geometry, chronology and confirmation freshness are checked. This encodes retest validation; it does not yet discover the correct left candle or all market structure.

`pipSize` is mandatory per broker symbol: there is no silent pip default and no lot/profit calculation. The owner has confirmed 0.10-price pips (4000 → 4005 = 50 pips); `lib/engine/config.ts` records the confirmed convention. Maximum entry-zone width is 80 pips and the configured SL buffer is at most 30 pips outside the zone. That buffer does not cap total loss from entry. BUY invalidation is below the zone; SELL invalidation is above it.

TP1 and TP2 use the nearest two distinct supplied confirmed M5/M15/M30 roadblocks, ahead of the entire entry zone and before the supplied setup-timeframe target. TP3 uses that higher target. Fewer than two roadblocks means no candidate, rather than invented R multiples. Structure detection and full provenance validation remain upstream work.

The monitor creates stable event IDs. It observes BUY exits on bid and SELL exits on ask. TP levels use quotes. Strictly more than 50 favorable pips from the conservative entry-zone edge emits `Close Partial and SET Break Even now!` once in the supplied state. No execution or lot size is inferred. Only an explicitly completed M5 exit-side candle closing strictly beyond SL creates an SL event. A wick beyond SL with close holding produces a possible sweep observation, not guaranteed reversal. Quotes and candle-close observations at the same timestamp are tracked separately.

Events describe hypothetical observations. Broker fills, profits and automatic partial closure/BE changes are not claimed. The actual hard stop in MT5 can execute on a wick and differ from the app's close-based invalidation. Monitoring state and events must be committed transactionally before connecting this module to the existing push outbox. Missing observations, reconnect backfill, market sessions and multi-process locking still need implementation; the monitor cannot claim complete intrabar history.

## MT5 Vestrado source

The owner uses MetaTrader 5 with Vestrado. The intended integration is a read-only EA/terminal bridge on an always-on Windows PC/VPS, sending normalized candles and bid/ask ticks to a separately authenticated ingestion endpoint. Never send broker passwords to the app, chat or GitHub. Render hosts the web app; it does not run a Windows MT5 terminal. No terminal connection or VPS is configured yet.

First confirm exact broker symbol name (including suffix), digits, point size and session/calendar boundaries from the owner's terminal. M5 chart candles are commonly bid-based; SELL invalidation requires actual ask-side evidence or must remain unavailable, rather than inventing historical ask candles from the current spread.

Tick volume counts feed activity. It does not establish aggressive buy/sell volume. Buy/sell imbalance needs genuinely classified transactions; order-book depth needs broker-supported DOM subscription. If Vestrado does not provide either, report unavailable. Do not synthesize an imbalance from green/red candles or label broker depth as global gold liquidity. A direction filter and thresholds still require definition and testing. Confirm broker terms for derived signals and any redistribution to clients.

## Database rollout

Migration `202610300009_engine_timeframes.sql` is additive to the existing live schema. Apply only migration 009 to the existing project; do not rerun initial `setup.sql`. It adds M15/MN1 and restricts new D1 assignments, preserving historical daily rows. App selections must be deployed after this migration. The old quote reconciler still implements its earlier touch-based observation semantics: do not connect it to these close-based engine signals until the two paths are explicitly reconciled.

## Signed snapshot transport (implemented, not activated live)

`POST /api/bridge/mt5` accepts only the existing Vestrado snapshot schema. Enable it explicitly with server-side `MT5_BRIDGE_ENABLED=true` and an independent random `MT5_BRIDGE_SECRET` of 32–256 characters. Do not reuse the service-role or broker key. The bridge secret belongs only on the trusted uploader PC and server, never in browser code. The Windows uploader prompts for it with hidden input and keeps it only in process memory. Do not paste it into screenshots, shell arguments or GitHub.

Each request signs `timestampMilliseconds + '.' + SHA256(exactUtf8Body)` with HMAC-SHA256. The route enforces a 60-second signature window, 2 MiB streamed cap, exact symbol/schema, completed chronological candles, snapshot freshness up to 30 seconds and broker-tick age up to 60 seconds. Migration 010 adds private service-only storage, same-export replay/conflict handling, out-of-order rejection, 12 accepted snapshots/minute limit, one latest payload and 24-hour metadata receipts. It grants no client market-data visibility and does not create a signal. Broker clocks are retained as broker clocks; no historical DST assumption is introduced.

Apply migrations 009 then 010 once to the existing dedicated project, before deploying the engine branch. Never rerun setup.sql on the live database. Configure the independent bridge secret and enable flag in Render, then deploy the engine branch. PowerShell uploader: download `mt5/Start-PantherBridge.ps1`, review it, and run from a Windows PowerShell window using `powershell.exe -NoProfile -File .\Start-PantherBridge.ps1`. If Windows blocks downloaded scripts, inspect the file and use file-specific Properties → Unblock; do not disable the system execution policy. It is not tested on the owner's Windows PC yet. The uploader only reads the Common Files snapshot, signs it and posts to the fixed PantherPRO HTTPS endpoint. It does not read broker credentials or modify trades. Ctrl+C stops it.

Because each 10-second snapshot contains all candle history and is not a tick-event stream, it remains unsuitable for claiming every intrainterval TP/partial touch. Reconnect recovery and reliable tick streaming, calendar time normalization, automatic structure detection, transactional event/outbox persistence and forward testing are still outstanding. No automatic signal publication is enabled by adding this transport.

## Prototype structure scan

`npm run engine:scan` performs one read-only shadow scan of the latest private MT5 snapshot. It rejects stale bridge receipts and old broker ticks. It does not run continuously, create a signal, call the notification outbox or place a trade. On the managed cloud executor, use the supported Node environment-proxy option when making this network call.

The prototype defines a swing high/low as a strict extremum with two completed candles on each side; ties do not qualify. Breakout detection excludes the current breakout candle from swing confirmation. Prior structure requires two higher highs and higher lows (up), or two lower highs and lower lows (down). A first candle-close crossing the last confirmed pivot in the trend direction is provisionally BOS; the opposite is provisionally CHOCH. A later recross of an already-broken level is not emitted as a fresh structural break. These are explicit initial detector conventions, not a validated discretionary trading method or an activated strategy. It examines the latest completed setup candle only, so it is not a historical backtest or pending-breakout retest tracker.

M15/M30/H1/H4/W1/MN1 are analysed independently. M5 is not a setup timeframe. QM, trendline, zone discovery, multi-timeframe alignment and stateful pullback/retest tracking remain unimplemented in this scanner. It does not label missing order-flow evidence as bullish or bearish. No successful shadow scan proves accuracy or publishes a trading signal.

The owner explicitly confirmed 50 pips = 5.00 price on 30 October 2026. The engine configuration locks pip size 0.10, maximum zone width 8.00 and SL buffer 3.00 outside the zone. Lot sizes are not inputs. Auto-publication remains disabled because the scanner-to-candidate-to-monitor integration is not complete.
