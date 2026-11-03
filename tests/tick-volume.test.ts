import { test } from "node:test";
import assert from "node:assert/strict";
import { tickVolumeMomentum, scanTickVolume } from "../lib/engine/tick-volume";
const server = Date.parse("2026-11-03T15:00:00Z") / 1000;
function bars() {
  return Array.from({ length: 21 }, (_, i) => ({
    opened_at_server_raw: server - (21 - i) * 300,
    open: 2700,
    high: 2705,
    low: 2699,
    close: 2704,
    tick_volume: i === 20 ? 150 : 100,
    real_volume: null,
    spread_points: 20,
  }));
}
test("independent BUY uses 20 earlier bars, excluding signal candle", () => {
  const result = tickVolumeMomentum(bars(), server);
  assert.equal(result.direction, "BUY");
  assert.equal(result.volumeRatio, 1.5);
});
test("independent SELL mirrors momentum direction", () => {
  const b = bars();
  Object.assign(b[20], { open: 2704, close: 2700 });
  assert.equal(tickVolumeMomentum(b, server).direction, "SELL");
});
test("volume spike without a directional body does not signal", () => {
  const b = bars();
  b[20].close = b[20].open;
  assert.equal(tickVolumeMomentum(b, server).direction, "WAIT");
});
test("low activity and rejection against momentum do not signal", () => {
  const b = bars();
  b[20].tick_volume = 149;
  assert.equal(tickVolumeMomentum(b, server).direction, "WAIT");
  b[20].tick_volume = 200;
  Object.assign(b[20], { low: 2700, high: 2710, close: 2706 });
  assert.equal(tickVolumeMomentum(b, server).direction, "WAIT");
});
test("unfinished, stale and gapped candles are withheld", () => {
  assert.equal(tickVolumeMomentum(bars(), server - 1).direction, "WAIT");
  assert.equal(tickVolumeMomentum(bars(), server + 300).direction, "WAIT");
  const b = bars();
  b[5].opened_at_server_raw -= 1;
  assert.equal(tickVolumeMomentum(b, server).direction, "WAIT");
});
test("missing volume or short history cannot create a signal", () => {
  assert.equal(tickVolumeMomentum(bars().slice(1), server).direction, "WAIT");
  const b = bars();
  b[3].tick_volume = 0;
  assert.equal(tickVolumeMomentum(b, server).direction, "WAIT");
});
function snapshot() {
  return {
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    exported_at_utc: "2026.11.03 15:00:00",
    bar_time_basis: "broker_server",
    server_time_raw: server,
    digits: 2,
    point: 0.01,
    quote: {
      bid: 2704,
      ask: 2704.2,
      last_tick_time_raw: server,
      last_tick_time_msc_raw: server * 1000,
    },
    series: ["M5", "M15", "M30", "H1", "H4", "W1", "MN1"].map((timeframe) => ({
      timeframe,
      availability: timeframe === "M5" ? "available" : "unavailable",
      candles: timeframe === "M5" ? bars() : [],
    })),
    order_book: null,
    aggressive_buy_sell_imbalance: null,
    execution_enabled: false,
  };
}
test("scan needs no Daily, QM, BOS, CHOCH, trendline or session filter", () => {
  const result = scanTickVolume(snapshot(), server * 1000);
  assert.equal(result.direction, "BUY");
  assert.equal(result.mode, "policy_controlled");
  assert.equal(result.publicationRequiresPolicy, true);
  assert.equal(
    result.candidateId,
    scanTickVolume(snapshot(), server * 1000 + 10000).candidateId,
  );
  assert.throws(
    () => scanTickVolume(snapshot(), server * 1000 + 30001),
    /Fresh broker/,
  );
});

import {
  tickVolumeRisk,
  tickVolumeLevels,
  type TickRoadblock,
} from "../lib/engine/tick-volume";
test("BUY and SELL risk use nearest opposing support/resistance and three ordered roadblocks", () => {
  const levels: TickRoadblock[] = [
    { timeframe: "M5", kind: "support", price: 2698 },
    { timeframe: "M15", kind: "support", price: 2690 },
    { timeframe: "M30", kind: "support", price: 2680 },
    { timeframe: "M30", kind: "support", price: 2698 },
    { timeframe: "H1", kind: "support", price: 2690 },
    { timeframe: "M5", kind: "resistance", price: 2701 },
    { timeframe: "M30", kind: "resistance", price: 2705 },
    { timeframe: "H1", kind: "resistance", price: 2710 },
    { timeframe: "H4", kind: "resistance", price: 2720 },
    { timeframe: "M30", kind: "resistance", price: 2705 },
  ];
  const buy = tickVolumeRisk("BUY", 2700.2, levels, 0.01)!;
  assert.equal(buy.stop, 2698);
  assert.deepEqual(buy.targets, [2705, 2710, 2720]);
  const sell = tickVolumeRisk("SELL", 2700, levels, 0.01)!;
  assert.equal(sell.stop, 2701);
  assert.deepEqual(sell.targets, [2698, 2690, 2680]);
  assert.equal(
    tickVolumeRisk(
      "BUY",
      2700,
      levels.filter((l) => l.price !== 2720),
      0.01,
    ),
    null,
  );
});
test("risk is withheld when no structural levels exist", () => {
  const result = scanTickVolume(snapshot(), server * 1000);
  assert.equal(result.status, "withheld_missing_roadblocks");
  assert.equal(result.entry, null);
  assert.equal(result.risk, null);
});
test("future and already swept pivots are excluded from roadblocks", () => {
  const b = bars().slice(0, 7);
  b.forEach((c, i) => Object.assign(c, { high: 2705 + (i === 2 ? 5 : 0) }));
  const series = [
    {
      timeframe: "M5" as const,
      availability: "available" as const,
      candles: b,
    },
  ];
  assert.ok(tickVolumeLevels(series, server).some((l) => l.price === 2710));
  assert.equal(
    tickVolumeLevels(series, b[3].opened_at_server_raw + 300).length,
    0,
  );
  b[6].high = 2711;
  assert.equal(
    tickVolumeLevels(series, server).some((l) => l.price === 2710),
    false,
  );
});
