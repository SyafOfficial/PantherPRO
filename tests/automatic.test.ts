import { test } from "node:test";
import assert from "node:assert/strict";
import { scanAutomatic, targetEvidence } from "../lib/engine/automatic";
import { mt5SnapshotSchema, snapshotUtc } from "../lib/engine/mt5";
const now = snapshotUtc("2026.10.30 14:00:20"),
  server = now / 1000 + 10800,
  confirmed = server - 20;
function fixture() {
  const setup = [
    95, 94, 96, 93, 90, 91, 85, 87, 80, 82, 70, 71, 75, 72, 71, 73, 77, 74, 73,
    74, 76, 78,
  ];
  const lower = [
    88, 89, 90, 87, 82, 83, 85, 81, 76, 78, 80, 77, 74, 75, 77, 74, 73, 74, 76,
    77.7,
  ];
  const higher = [
    60, 61, 65, 62, 61, 63, 67, 64, 63, 64, 66, 68, 65, 64, 66, 70, 67, 66, 68,
    72, 69, 68, 70, 74,
  ];
  const values = {
    M5: lower,
    M15: setup,
    M30: higher,
    H1: Array(30).fill(75),
    H4: Array(30).fill(75),
    W1: Array(30).fill(75),
    MN1: Array(20).fill(75),
  };
  const step = {
    M5: 300,
    M15: 900,
    M30: 1800,
    H1: 3600,
    H4: 14400,
    W1: 604800,
    MN1: 0,
  };
  const series = Object.entries(values).map(([timeframe, values]) => ({
    timeframe,
    availability: "available",
    candles: values.map((price, i) => ({
      opened_at_server_raw:
        timeframe === "MN1"
          ? Date.UTC(2025, 1 + i, 1) / 1000
          : confirmed -
            300 -
            values.length * step[timeframe as keyof typeof step] +
            i * step[timeframe as keyof typeof step],
      open: price,
      close: price,
      high: price + 0.2,
      low: price - 0.2,
      tick_volume: 100,
      real_volume: null,
      spread_points: 10,
    })),
  }));
  const m5 = series[0].candles;
  m5.forEach(
    (b, i) => (b.opened_at_server_raw = confirmed - m5.length * 300 + i * 300),
  );
  Object.assign(m5.at(-1)!, { open: 77.4, close: 77.7, low: 76.5, high: 78 });
  return {
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    exported_at_utc: "2026.10.30 14:00:20",
    bar_time_basis: "broker_server",
    server_time_raw: server,
    digits: 2,
    point: 0.01,
    quote: {
      bid: 77.5,
      ask: 77.6,
      last_tick_time_raw: server - 1,
      last_tick_time_msc_raw: (server - 1) * 1000 + 500,
    },
    series,
    order_book: null,
    aggressive_buy_sell_imbalance: null,
    execution_enabled: false,
  };
}
test("automatic BOS assembles a fresh M5 zone, higher context and actual structural targets", () => {
  const data = fixture(),
    result = scanAutomatic(data, now);
  const plan = result.plans.find(
    (p) => p.method === "BOS" && p.timeframe === "M15",
  );
  assert.ok(plan);
  assert.equal(plan.direction, "BUY");
  assert.equal(plan.zoneLow, 76.5);
  assert.equal(plan.zoneHigh, 78);
  assert.equal(plan.stop, 73.5);
  assert.equal(plan.entry, 77.6);
  assert.ok(plan.targets[0] > 78);
  assert.ok(
    plan.targets[0] < plan.targets[1] && plan.targets[1] < plan.targets[2],
  );
  assert.equal(plan.higherTimeframe, "M30");
  assert.equal(plan.status, "policy_candidate");
  assert.match(plan.reason, /News feed unavailable/);
  assert.equal(
    new Set(result.plans.map((p) => p.id)).size,
    result.plans.length,
  );
});
test("automatic plan never chases entry, fabricates targets or uses stale data", () => {
  const data = fixture();
  assert.equal(
    scanAutomatic(
      { ...data, quote: { ...data.quote, bid: 79, ask: 79.1 } },
      now,
    ).plans.length,
    0,
  );
  assert.throws(() => scanAutomatic(data, now + 30001));
  const noRoadblocks = structuredClone(data);
  noRoadblocks.series
    .find((s) => s.timeframe === "M5")!
    .candles.slice(0, -1)
    .forEach((b) =>
      Object.assign(b, { open: 77, high: 77.1, low: 76.9, close: 77 }),
    );
  assert.equal(scanAutomatic(noRoadblocks, now).plans.length, 0);
  const oversized = structuredClone(data);
  oversized.series[0].candles.at(-1)!.low = 65;
  assert.equal(scanAutomatic(oversized, now).plans.length, 0);
});
test("SELL publication requires genuinely supplied completed ask-side M5 evidence", () => {
  const s = fixture();
  for (const frame of s.series)
    for (const b of frame.candles) {
      const old = { ...b };
      Object.assign(b, {
        open: 200 - old.open,
        close: 200 - old.close,
        high: 200 - old.low,
        low: 200 - old.high,
      });
    }
  s.quote = { ...s.quote, bid: 122.4, ask: 122.5 };
  assert.equal(scanAutomatic(s, now).plans.length, 0);
  const m5 = s.series[0].candles.at(-1)!;
  const withAsk = {
    ...s,
    ask_m5: [
      {
        ...m5,
        open: m5.open + 0.1,
        high: m5.high + 0.1,
        low: m5.low + 0.1,
        close: m5.close + 0.1,
      },
    ],
  };
  assert.ok(
    scanAutomatic(withAsk, now).plans.some(
      (p) => p.direction === "SELL" && p.method === "BOS",
    ),
  );
});
test("confirmed targets are capped at setup timeframe roadblock and require distinct lower levels", () => {
  const s = mt5SnapshotSchema.parse(fixture()),
    result = targetEvidence(s, "M15", true, 76.5, 78, confirmed);
  assert.ok(result);
  assert.ok(
    result.obstacles.every(
      (o) => o.price < result.maximumTarget && o.price > 78,
    ),
  );
  const bad = structuredClone(s);
  for (const frame of bad.series)
    for (const b of frame.candles)
      Object.assign(b, { open: 77, close: 77, high: 77.1, low: 76.9 });
  assert.equal(targetEvidence(bad, "M15", true, 76.5, 78, confirmed), null);
});
import { methodTriggers } from "../lib/engine/automatic";
function patternBars(values: number[]) {
  return values.map((v, i) => ({
    opened_at_server_raw: 100000 + i * 900,
    open: v,
    close: v,
    high: v + 0.2,
    low: v - 0.2,
    tick_volume: 100,
    real_volume: null,
    spread_points: 10,
  }));
}
test("QM requires a higher head and actual neckline close break; mirrored structure gives BUY", () => {
  const bars = patternBars([10, 11, 14, 12, 11, 12, 16, 14, 13, 12, 10]);
  const sell = methodTriggers(bars).find((t) => t.method === "QM");
  assert.ok(sell);
  assert.equal(sell.buy, false);
  assert.equal(sell.level, 14.2);
  const wick = structuredClone(bars);
  wick.at(-1)!.close = 12;
  assert.equal(
    methodTriggers(wick).some((t) => t.method === "QM"),
    false,
  );
  const mirrored = bars.map((b) => ({
    ...b,
    open: 30 - b.open,
    close: 30 - b.close,
    high: 30 - b.low,
    low: 30 - b.high,
  }));
  assert.equal(
    methodTriggers(mirrored).find((t) => t.method === "QM")?.buy,
    true,
  );
});
test("trendline requires two confirmed rising anchors and third-touch candle rejection", () => {
  const bars = patternBars([
    12, 11, 10, 11, 12, 13, 12, 11, 12, 13, 14, 13, 12,
  ]);
  Object.assign(bars.at(-1)!, {
    open: 11.9,
    close: 12.4,
    high: 12.6,
    low: 11.8,
  });
  assert.ok(
    methodTriggers(bars).some((t) => t.method === "TRENDLINE" && t.buy),
  );
  const miss = structuredClone(bars);
  Object.assign(miss.at(-1)!, { open: 14, close: 14.5, low: 13.9, high: 14.6 });
  assert.equal(
    methodTriggers(miss).some((t) => t.method === "TRENDLINE" && t.buy),
    false,
  );
});
