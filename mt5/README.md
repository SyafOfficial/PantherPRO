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

The 10-second snapshot timer is not a lossless tick stream. It cannot prove intrainterval TP touches or capture every movement above 50 pips. A later live bridge needs event streaming/sequence and replay rules before reliable notification monitoring.
