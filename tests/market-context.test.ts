import { test } from "node:test";
import assert from "node:assert/strict";
import { marketContext } from "../lib/market-context";
import type { MT5Display } from "../lib/engine/display";
const now = Date.parse("2026-10-30T15:45:00Z");
function fixture(flat = false): MT5Display {
  return {
    symbol: "XAUUSD.V",
    timeframe: "H1",
    time_basis: "broker_server",
    exported_at: new Date(now).toISOString(),
    refresh_seconds: 10,
    chart_kind: "completed_broker_candles_and_observed_bid",
    quote: {
      bid: 4020,
      ask: 4020.2,
      source_name: "Vestrado MT5",
      observed_at: new Date(now).toISOString(),
      received_at: new Date(now).toISOString(),
      max_gap_seconds: 30,
    },
    bars: Array.from({ length: 100 }, (_, i) => {
      const close = flat
        ? 4000
        : 4000 + i * 0.2 + Math.sin((i * Math.PI) / 3) * 2;
      return {
        opened_at_server_raw: 10000 + i * 3600,
        open: close,
        close,
        high: close + 1,
        low: close - 1,
      };
    }),
  };
}
test("MT5 context derives directional structure and finite indicators from real supplied candles", () => {
  const result = marketContext(fixture(), now);
  assert.equal(result.status, "ready");
  assert.equal(result.structure, "up");
  assert.equal(result.bias, "bullish");
  assert.ok(result.ema20 > result.ema50);
  assert.ok(result.rsi14 >= 0 && result.rsi14 <= 100);
  assert.ok(result.atr14 > 0);
  assert.equal(result.bars, 100);
});
test("flat prices have neutral momentum and stale quotes never claim live context", () => {
  const flat = marketContext(fixture(true), now);
  assert.notEqual(flat.status, "insufficient_history");
  if (flat.status === "insufficient_history") return;
  assert.equal(flat.rsi14, 50);
  assert.equal(flat.ema20, 4000);
  assert.equal(flat.ema50, 4000);
  assert.equal(flat.atr14, 2);
  assert.equal(flat.bias, "mixed");
  assert.equal(marketContext(fixture(), now + 31000).status, "stale");
  assert.equal(
    marketContext({ ...fixture(), bars: fixture().bars.slice(0, 49) }, now)
      .status,
    "insufficient_history",
  );
});
