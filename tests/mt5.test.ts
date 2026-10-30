import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectMt5Snapshot, snapshotUtc } from "../lib/engine/mt5";
function fixture() {
  const utc = snapshotUtc("2026.10.30 12:39:13"),
    server = utc / 1000 + 10800;
  return {
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    exported_at_utc: "2026.10.30 12:39:13",
    bar_time_basis: "broker_server",
    server_time_raw: server,
    digits: 2,
    point: 0.01,
    quote: {
      bid: 4000,
      ask: 4000.3,
      last_tick_time_raw: server - 1,
      last_tick_time_msc_raw: (server - 1) * 1000 + 539,
    },
    series: ["M5", "M15", "M30", "H1", "H4", "W1", "MN1"].map((timeframe) => ({
      timeframe,
      availability: "available",
      candles: [
        {
          opened_at_server_raw: server - 40 * 86400,
          open: 4000,
          high: 4001,
          low: 3999,
          close: 4000.1,
          tick_volume: 123,
          real_volume: null,
          spread_points: 30,
        },
      ],
    })),
    order_book: null,
    aggressive_buy_sell_imbalance: null,
    execution_enabled: false,
  };
}
const now = snapshotUtc("2026.10.30 12:39:13");
test("MT5 snapshot reports observed offset without converting historical bars or inventing liquidity", () => {
  const r = inspectMt5Snapshot(fixture(), now);
  assert.equal(r.timing.observedCurrentOffsetSeconds, 10800);
  assert.equal(r.timing.historicalUtcConversion, "not_verified");
  assert.equal(r.series.length, 7);
  assert.equal(r.series[0].tickVolumeAvailable, true);
  assert.equal(r.liquidity.aggressiveBuySellImbalance, "unavailable");
  assert.equal(r.liquidity.orderBook, "unavailable");
  assert.equal(r.freshness.usableCurrentQuote, true);
  assert.equal(r.signalEngineConnected, false);
});
test("old exports and stale ticks never count as live quotes", () => {
  assert.equal(
    inspectMt5Snapshot(fixture(), now + 30001).freshness.usableCurrentQuote,
    false,
  );
  assert.equal(
    inspectMt5Snapshot(fixture(), now - 1).freshness.usableCurrentQuote,
    false,
  );
  const f = fixture();
  f.quote.last_tick_time_raw -= 61;
  f.quote.last_tick_time_msc_raw -= 61000;
  assert.equal(inspectMt5Snapshot(f, now).freshness.usableCurrentQuote, false);
});
test("snapshot rejects wrong symbol, duplicate frames, future bars and broken price geometry", () => {
  const s = fixture();
  assert.throws(() => inspectMt5Snapshot({ ...s, symbol: "XAUUSD" }, now));
  const frames = structuredClone(s);
  frames.series[1].timeframe = "M5";
  assert.throws(() => inspectMt5Snapshot(frames, now));
  const bad = structuredClone(s);
  bad.series[0].candles[0].high = 3900;
  assert.throws(() => inspectMt5Snapshot(bad, now));
  const future = structuredClone(s);
  future.series[0].candles[0].opened_at_server_raw = future.server_time_raw;
  assert.throws(() => inspectMt5Snapshot(future, now));
  assert.throws(() => snapshotUtc("2026.02.30 00:00:00"));
});
