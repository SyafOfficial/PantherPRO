import { test } from "node:test";
import assert from "node:assert/strict";
import { displaySnapshot } from "../lib/engine/display";
import { quoteFreshness } from "../lib/market-data";
function fixture() {
  return {
    received_at: "2026-10-30T15:45:01Z",
    exported_at: "2026-10-30T15:45:00Z",
    source: "Vestrado MT5",
    symbol: "XAUUSD.V",
    timeframe: "H1",
    server_time_raw: 200000,
    quote: {
      bid: 3904.35,
      ask: 3904.73,
      last_tick_time_raw: 199999,
      secret: "must_not_leave_server",
    },
    candles: Array.from({ length: 120 }, (_, i) => ({
      opened_at_server_raw: 1000 + i * 3600,
      open: 3900,
      high: 3910,
      low: 3890,
      close: 3905,
      tick_volume: 1000,
    })),
  };
}
test("market display contains actual source OHLC, bid/ask and last 100 bars without invented bars or private fields", () => {
  const f = fixture();
  f.server_time_raw = 1000000;
  f.quote.last_tick_time_raw = 999999;
  const r = displaySnapshot(f, "H1");
  assert.equal(r.bars.length, 100);
  assert.equal(r.quote.bid, 3904.35);
  assert.equal(r.quote.ask, 3904.73);
  assert.equal(
    r.bars[0].opened_at_server_raw,
    f.candles[20].opened_at_server_raw,
  );
  assert.equal(r.bars.at(-1)!.close, 3905);
  assert.equal(r.time_basis, "broker_server");
  assert.equal("secret" in r.quote, false);
  assert.equal("tick_volume" in r.bars[0], false);
  assert.equal(
    quoteFreshness(r.quote, Date.parse("2026-10-30T15:45:02Z")),
    true,
  );
  assert.equal(
    quoteFreshness(r.quote, Date.parse("2026-10-30T15:46:00Z")),
    false,
  );
});
test("display refuses mislabeled, wrong-source, reversed and malformed candles rather than substitute data", () => {
  const f = fixture();
  f.server_time_raw = 1000000;
  f.quote.last_tick_time_raw = 999999;
  assert.throws(() => displaySnapshot(f, "M15"));
  assert.throws(() => displaySnapshot({ ...f, source: "other source" }, "H1"));
  assert.throws(() =>
    displaySnapshot({ ...f, candles: [...f.candles].reverse() }, "H1"),
  );
  const bad = structuredClone(f);
  bad.candles[0].high = 3800;
  assert.throws(() => displaySnapshot(bad, "H1"));
  assert.throws(() =>
    displaySnapshot({ ...f, quote: { ...f.quote, ask: 3800 } }, "H1"),
  );
});
