import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ownerZone,
  zoneUntouched,
  ownerConfirmation,
  ownerTargets,
  ownerSession,
  monitorOwnerShadow,
  scanOwnerShadow,
  type ShadowSetup,
} from "../lib/engine/owner-shadow";
const bar = (open: number, close: number, low: number, high: number) => ({
  opened_at_server_raw: 1000,
  open,
  close,
  low,
  high,
  tick_volume: 1,
  real_volume: null,
  spread_points: 1,
});
test("owner pip convention, zone bounds and targets from observed entry", () => {
  assert.deepEqual(ownerZone(2700, 2705), { low: 2700, high: 2705 });
  assert.ok(ownerZone(2700, 2708));
  assert.equal(ownerZone(2700, 2704.99), null);
  assert.equal(ownerZone(2700, 2708.01), null);
  assert.deepEqual(
    ownerTargets(2703, "BUY", [2707, 2710, 2710, 2715, 2720]),
    [2708, 2710, 2715],
  );
  assert.deepEqual(
    ownerTargets(2703, "SELL", [2700, 2695, 2690]),
    [2698, 2695, 2690],
  );
  assert.equal(ownerTargets(2703, "BUY", [2707, 2710]), null);
});
test("freshness rejects wick touches including exact boundaries", () => {
  const z = ownerZone(2700, 2705)!;
  assert.equal(zoneUntouched(z, [bar(2706, 2707, 2705, 2708)]), false);
  assert.equal(zoneUntouched(z, [bar(2706, 2707, 2705.01, 2708)]), true);
});
test("rejection or body engulfing, never any directional candle", () => {
  assert.equal(
    ownerConfirmation(undefined, bar(2702, 2703, 2700, 2703), "BUY"),
    "rejection",
  );
  assert.equal(
    ownerConfirmation(undefined, bar(2703, 2702, 2702, 2705), "SELL"),
    "rejection",
  );
  assert.equal(
    ownerConfirmation(
      bar(2703, 2702, 2701, 2704),
      bar(2701, 2704, 2701, 2704),
      "BUY",
    ),
    "engulfing",
  );
  assert.equal(
    ownerConfirmation(undefined, bar(2700, 2704, 2700, 2704), "BUY"),
    null,
  );
});
test("Malaysia session boundaries cross midnight", () => {
  assert.equal(ownerSession(Date.parse("2026-11-02T22:00:00Z")), true); // 06:00
  assert.equal(ownerSession(Date.parse("2026-11-02T18:59:59Z")), true);
  assert.equal(ownerSession(Date.parse("2026-11-02T19:00:00Z")), false);
  assert.equal(ownerSession(Date.parse("2026-11-02T21:59:59Z")), false);
});
const setup: ShadowSetup = {
  id: "test",
  mode: "shadow_only",
  timeframe: "H1",
  direction: "BUY",
  method: "BOS",
  location: "fresh_zone",
  zone: { low: 2700, high: 2706 },
  invalidation: 2698,
  breakStrength: "close",
  status: "entry_confirmed",
  entry: 2703,
  targets: [2708, 2710, 2715],
  pending: [],
};
const initial = () => ({
  targets: [],
  invalidated: false,
  lastQuote: 0,
  lastClose: 0,
});
test("each TP emits once, quote gap emits all crossed targets", () => {
  const a = monitorOwnerShadow(setup, initial(), {
    at: 1,
    bid: 2708,
    ask: 2708.2,
  });
  assert.deepEqual(
    a.events.map((e) => e.kind),
    ["tp1"],
  );
  const b = monitorOwnerShadow(setup, a.state, {
    at: 2,
    bid: 2716,
    ask: 2716.2,
  });
  assert.deepEqual(
    b.events.map((e) => e.kind),
    ["tp2", "tp3"],
  );
  assert.equal(
    monitorOwnerShadow(setup, b.state, { at: 3, bid: 2716, ask: 2716.2 }).events
      .length,
    0,
  );
  assert.equal(new Set([...a.events, ...b.events].map((e) => e.id)).size, 3);
});
test("wick crossing does not invalidate; M5 close strictly beyond does", () => {
  const a = monitorOwnerShadow(setup, initial(), {
    at: 300,
    bid: 2697,
    ask: 2697.2,
    m5: { closedAt: 300, close: 2698 },
  });
  assert.equal(a.state.invalidated, false);
  const b = monitorOwnerShadow(setup, a.state, {
    at: 600,
    bid: 2697,
    ask: 2697.2,
    m5: { closedAt: 600, close: 2697 },
  });
  assert.deepEqual(
    b.events.map((e) => e.kind),
    ["invalidation_m5"],
  );
  assert.equal(
    monitorOwnerShadow(setup, b.state, { at: 601, bid: 2720, ask: 2721 }).events
      .length,
    0,
  );
});
test("sell TP observes ask and mirrored invalidation", () => {
  const sell = {
    ...setup,
    direction: "SELL" as const,
    targets: [2698, 2695, 2690] as [number, number, number],
    invalidation: 2708,
  };
  assert.equal(
    monitorOwnerShadow(sell, initial(), { at: 1, bid: 2697, ask: 2699 }).events
      .length,
    0,
  );
  assert.equal(
    monitorOwnerShadow(sell, initial(), { at: 1, bid: 2697, ask: 2698 })
      .events[0].kind,
    "tp1",
  );
  assert.equal(
    monitorOwnerShadow(sell, initial(), {
      at: 300,
      bid: 2708,
      ask: 2709,
      m5: { closedAt: 300, close: 2709 },
    }).events[0].kind,
    "invalidation_m5",
  );
});
test("scan rejects malformed input rather than synthesizing data", () =>
  assert.throws(() => scanOwnerShadow({}, Date.now())));

test("legacy seven-frame snapshots remain accepted; v2 requires Daily history and rejects stale feed", () => {
  const now = Date.parse("2026-11-02T08:00:00Z"),
    server = now / 1000;
  const names = ["M5", "M15", "M30", "H1", "H4", "W1", "MN1"];
  const snapshot = {
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    exported_at_utc: "2026.11.02 08:00:00",
    bar_time_basis: "broker_server",
    server_time_raw: server,
    digits: 2,
    point: 0.01,
    quote: {
      bid: 2700,
      ask: 2700.2,
      last_tick_time_raw: server,
      last_tick_time_msc_raw: server * 1000,
    },
    series: names.map((timeframe) => ({
      timeframe,
      availability: timeframe === "M5" ? "available" : "unavailable",
      candles:
        timeframe === "M5"
          ? [
              {
                ...bar(2700, 2700, 2699, 2701),
                opened_at_server_raw: server - 300,
              },
            ]
          : [],
    })),
    order_book: null,
    aggressive_buy_sell_imbalance: null,
    execution_enabled: false,
  };
  const result = scanOwnerShadow(snapshot, now);
  assert.match(result.reasons.join(" "), /Daily history missing/);
  assert.equal(result.setups.length, 0);
  assert.throws(() => scanOwnerShadow(snapshot, now + 30001), /Fresh broker/);
});

const now = Date.parse("2026-10-30T14:00:20Z"),
  server = now / 1000 + 10800,
  confirmed = server - 20;
function scannerFixture() {
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

test("scanner produces private monitor candidates with aligned highest-frame context", () => {
  const s = scannerFixture();
  const higher = s.series.find((x) => x.timeframe === "M30")!;
  for (const frame of s.series.filter((x) =>
    ["H1", "H4", "W1"].includes(x.timeframe),
  )) {
    const step = { H1: 3600, H4: 14400, W1: 604800 }[frame.timeframe as "H1"];
    frame.candles = higher.candles.map((b, i) => ({
      ...b,
      opened_at_server_raw: confirmed - (higher.candles.length - i) * step,
    }));
  }
  s.series.push({
    timeframe: "D1",
    availability: "available",
    candles: higher.candles.map((b, i) => ({
      ...b,
      opened_at_server_raw: confirmed - (higher.candles.length - i) * 86400,
    })),
  });
  const r = scanOwnerShadow(s, now);
  assert.ok(r.setups.length > 0, JSON.stringify(r.reasons));
  assert.ok(r.setups.every((x) => x.mode === "shadow_only"));
  assert.ok(r.setups.every((x) => x.direction === "BUY"));
  assert.ok(
    r.setups.every(
      (x) => x.zone.high - x.zone.low >= 5 && x.zone.high - x.zone.low <= 8,
    ),
  );
  assert.equal(new Set(r.setups.map((x) => x.id)).size, r.setups.length);
});
