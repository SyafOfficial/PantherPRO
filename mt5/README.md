# Panther MT5 read-only exporter — first integration step

Default broker symbol: `XAUUSD.V`, confirmed from the owner's Vestrado MT5 chart. The EA exports only bid/ask, completed M5/M15/M30/H1/H4/W1/MN1 candles, tick volume, available real volume and optional broker DOM. It does not read account balance/login/password, trade history or positions. It has no trading or network functions. M5 data is for confirmation/roadblocks/SL; setup frames start at M15 and exclude D1.

## Installation on the Windows PC

1. In MT5 choose File → Open Data Folder. Open `MQL5/Experts` and put `PantherReadOnlyBridge.mq5` there.
2. Open MetaEditor with F4, open the file and compile with F7. It must report **0 errors** before attaching it. This cloud environment has no MetaEditor compiler, so compilation and terminal behavior are not yet verified.
3. In MT5 Navigator → Expert Advisors, refresh and attach the EA once to the `XAUUSD.V` chart. Keep `BridgeSymbol=XAUUSD.V`. No DLL permissions, broker credentials or WebRequest allowlist are required for this local exporter. It contains no order functions; do not change global Algo Trading settings merely to enable it. Keep MT5 and the PC running with internet connectivity.
4. Check the Experts tab. It prints the Common Files output path, not any credentials. Allow time for history downloads; unavailable timeframes remain explicitly unavailable and are retried on the timer.
5. The output is `<Common Data Folder>/Files/PantherFX/vestrado-snapshot.json`. Start with the printed path. It is separate from the terminal's usual local `MQL5/Files` folder. Each snapshot replaces a temporary file; the reader must still reject incomplete/old files.

## What this version does not do

It does not send data to Render, discover setups, deliver push, or operate while the PC is asleep. A separately authenticated uploader/ingestion path, source permissions, sequence/gap handling and persisted monitoring state still need implementation. Do not mistake a local export for a connected market feed.

`exported_at_utc` is the PC GMT snapshot time in `YYYY.MM.DD HH:MM:SS` format, not a tick freshness guarantee. MT5 tick and candle raw times are preserved separately as broker-server timestamps. Do not append `Z` or convert historical bars using only today's offset: broker DST/session rules must be confirmed. Prices are bid/ask observations; MT5 chart OHLC is generally bid-side. Historical SELL ask candles are not synthesized from bid bars and a current spread. MN1 is calendar monthly, not a fixed number of minutes.

DOM is optional and off by default. Missing DOM is `null`; broker DOM is not global spot-gold depth. Tick volume does not establish aggressive buy/sell volume, which remains `null`. `real_volume` may be unavailable or zero on an OTC feed. Confirm broker terms before sending market data to a client-facing service.

The v1.101 exporter defaults to a one-second timer and includes up to 5,000 recent broker ticks from an overlapping 30-second window. The uploader checks for changed files every 250 ms. The server replays new ticks in time order and deduplicates their cursor, preserving observed touches and retraces between uploads. Missing broker history, a disconnected terminal, overflow or a prolonged connection outage still prevents complete observation. This is not a broker execution feed.

## First real-terminal validation

The owner compiled this EA in MetaEditor with 0 errors and one Market-version-format warning, attached it to XAUUSD.V, and supplied an exported snapshot on 30 October 2026. The snapshot passed OHLC geometry, strict symbol/schema, candle ordering and completed-bar checks. It contains 300 bars each for M5/M15/M30/H1/H4/W1 and 268 monthly bars. Current tick volume is present; latest bars have no reported real volume. DOM was disabled, so a null book does not prove the broker lacks DOM capability. Aggressive buy/sell volume remains unavailable. The snapshot's broker wall clock is three hours ahead of its UTC export clock; this single observation does not establish historical DST rules. Exporting and uploading a file manually is not live ingestion.

Validate a local file with `npm run mt5:inspect -- path/to/vestrado-snapshot.json`. The validator reports freshness against the current clock; an uploaded historic snapshot is correctly considered stale for live signals. It does not modify the database, connect the feed or publish a signal. Do not commit actual broker snapshot files to the source repository.

## Transport uploader

`Start-PantherBridge.ps1` reads the local file and posts signed snapshots to `https://pantherpro.onrender.com/api/bridge/mt5`. It needs migrations 009/010 and server settings documented in `docs/engine.md`; the live app has not yet been switched to this branch. The script prompts for an independent bridge secret privately; never use the MT5 password or Supabase service-role key. It does not execute trades or send account data. Signing is tested on the TypeScript side; Windows PowerShell execution needs the owner's terminal test. Keep the PC, MT5 and uploader running. Free Render instances may sleep and cause upload timeouts; continuous operation needs a suitable always-on host.

## EA v1.100 ask-side M5 extension

The updated EA requests the latest completed M5 tick interval using MT5 `CopyTicksRange` and reconstructs an ask OHLC candle only from positive valid bid/ask ticks. It withholds empty/sparse history (first tick more than 60 seconds after the bar start or last tick more than 60 seconds before its end) and retries unavailable history. The result is `ask_m5`, cached for that completed bar. This supports SELL setup validation without applying a guessed spread to historical bid candles. Tick count here describes returned tick records, not aggressive buy/sell volume.

The original v0.10 exporter was compiled/tested by the owner; **v1.101 needs compilation and runtime validation in MetaEditor**. Recompile, replace the attached EA, and verify uploader acceptance plus an uploaded snapshot with ask evidence before assuming SELL monitoring is available. No DLLs, order functions or account credentials were added.

## Updating the live bridge for quote-touch alerts

Deploy the reviewed server/database changes before installing this EA: the old strict snapshot validator rejects `quote_ticks`.

1. Replace the local EA source with this revision, compile in MetaEditor, and reattach it to XAUUSD.V. Confirm `ExportEverySeconds=1` (existing chart inputs may retain the old value).
2. Restart the updated `Start-PantherBridge.ps1`, entering the existing bridge secret only in its hidden prompt.
3. Verify snapshot acceptance and that the server receives `quote_ticks` at approximately one-second intervals. An old exporter still works but remains sampled and can miss brief touches.
4. Enable app push permissions and target/signal preferences on an owner-approved test device, then measure observation-to-outbox-to-push-service times. Push-service acceptance does not prove handset display.

The server treats either Bid or Ask reaching or crossing TP as an observed HIT, including equality. SL requires the completed exit-side M5 close: BUY at/below SL, SELL at/above SL. Wicks alone do not count. This is the owner-selected alert convention, not a broker fill claim. Existing BE arming and zone-return rules are retained, with either-side return touches and no M5 wait.
