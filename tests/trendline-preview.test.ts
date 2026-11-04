import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewTrendline,
  trendlineAtr,
} from "../lib/engine/trendline-preview";
function fixture(breakout = false) {
  const values = [
    ...Array(10).fill(14),
    12,
    11,
    10,
    11,
    12,
    13,
    12,
    11,
    12,
    13,
    14,
    13,
    12,
  ];
  const setupBars = values.map((v, i) => ({
    opened_at_server_raw: 100000 + i * 900,
    open: v,
    high: v + 0.2,
    low: v - 0.2,
    close: v,
  }));
  Object.assign(
    setupBars.at(-1)!,
    breakout
      ? { open: 12.4, close: 11.1, high: 12.6, low: 10.8 }
      : { open: 11.9, close: 12.6, high: 12.8, low: 11.75 },
  );
  if (breakout)
    Object.assign(setupBars[20], {
      open: 12.6,
      close: 12.6,
      high: 14.2,
      low: 11.4,
    });
  const setupEnd = setupBars.at(-1)!.opened_at_server_raw + 900;
  const m5Bars = Array.from({ length: 17 }, (_, i) => ({
    opened_at_server_raw: setupEnd + 300 - (16 - i) * 300,
    open: breakout ? 11.6 : 12.2,
    close: breakout ? 11.6 : 12.2,
    high: breakout ? 11.8 : 12.4,
    low: breakout ? 11.4 : 11.9,
  }));
  Object.assign(
    m5Bars.at(-1)!,
    breakout
      ? { open: 11.8, close: 11.2, high: 12.1, low: 11.0 }
      : { open: 12.1, close: 12.7, high: 12.8, low: 12.0 },
  );
  return {
    setupBars,
    setupEnd,
    subsequentSetupBars: [],
    m5Bars,
    asOf: setupEnd + 600,
    higherTrend: breakout ? ("down" as const) : ("up" as const),
    bid: breakout ? 11.2 : 12.6,
    ask: breakout ? 11.25 : 12.65,
    point: 0.01,
    target: { buy: 20, sell: 5 },
  };
}
function mirror(x: ReturnType<typeof fixture>) {
  const reflect = (b: (typeof x.setupBars)[number]) => ({
    ...b,
    open: 100 - b.open,
    close: 100 - b.close,
    high: 100 - b.low,
    low: 100 - b.high,
  });
  return {
    ...x,
    setupBars: x.setupBars.map(reflect),
    m5Bars: x.m5Bars.map(reflect),
    bid: 100 - x.ask,
    ask: 100 - x.bid,
    higherTrend: x.higherTrend === "up" ? ("down" as const) : ("up" as const),
    target: { buy: 95, sell: 80 },
  };
}
test("bounce BUY and SELL require a fresh directional retest; line projection changes with time", () => {
  for (const x of [fixture(), mirror(fixture())]) {
    const [p] = previewTrendline(x);
    assert.ok(p);
    assert.equal(p.subtype, "bounce");
    assert.equal(p.direction, x.higherTrend === "up" ? "BUY" : "SELL");
    assert.notEqual(p.lineAtEvent, p.lineAtConfirmation);
    assert.ok(p.rewardRisk >= 1.5);
    assert.ok(p.direction === "BUY" ? p.stop < 10.8 : p.stop > 89.2);
  }
});
test("breakout BUY and SELL require a validated line, a close through it and later retest", () => {
  for (const x of [fixture(true), mirror(fixture(true))]) {
    const [p] = previewTrendline(x);
    assert.ok(p);
    assert.equal(p.subtype, "breakout_retest");
    assert.equal(p.direction, x.higherTrend === "up" ? "BUY" : "SELL");
  }
});
test("a previously broken line cannot be recycled as a fresh bounce", () => {
  const x = fixture();
  Object.assign(x.setupBars[20], {
    open: 12,
    high: 14.2,
    low: 11,
    close: 11.1,
  });
  assert.deepEqual(previewTrendline(x), []);
});
test("wick-only breakout, missing historical third touch and weak M5 rejection are rejected", () => {
  const wick = fixture(true);
  wick.setupBars.at(-1)!.close = 12.2;
  assert.deepEqual(previewTrendline(wick), []);
  const noTouch = fixture(true);
  noTouch.setupBars[20].low = 13.8;
  assert.deepEqual(previewTrendline(noTouch), []);
  const weak = fixture();
  weak.m5Bars.at(-1)!.close = 12.11;
  assert.deepEqual(previewTrendline(weak), []);
});
test("the later M5 candle must break its previous candle's high or low", () => {
  const x = fixture();
  x.m5Bars.at(-2)!.high = 12.9;
  assert.deepEqual(previewTrendline(x), []);
});
test("unknown/opposing context, wide spread, chased entry and nearby obstacle are rejected", () => {
  const x = fixture();
  assert.deepEqual(previewTrendline({ ...x, higherTrend: "unknown" }), []);
  assert.deepEqual(previewTrendline({ ...x, higherTrend: "down" }), []);
  assert.deepEqual(previewTrendline({ ...x, ask: x.bid + 2 }), []);
  assert.deepEqual(previewTrendline({ ...x, bid: 13, ask: 13.05 }), []);
  assert.deepEqual(
    previewTrendline({ ...x, target: { buy: 13, sell: 5 } }),
    [],
  );
});
test("future confirmation, unfinished setup and stale confirmation cannot create a setup", () => {
  const x = fixture();
  assert.deepEqual(previewTrendline({ ...x, asOf: x.asOf - 1 }), []);
  assert.deepEqual(previewTrendline({ ...x, setupEnd: x.asOf }), []);
  assert.deepEqual(previewTrendline({ ...x, asOf: x.asOf + 301 }), []);
});
test("missing history, invalid OHLC and unsorted candles fail closed", () => {
  const x = fixture();
  assert.deepEqual(
    previewTrendline({ ...x, setupBars: x.setupBars.slice(-10) }),
    [],
  );
  const bad = structuredClone(x);
  bad.m5Bars[0].high = 1;
  assert.deepEqual(previewTrendline(bad), []);
  assert.deepEqual(
    previewTrendline({ ...x, m5Bars: [...x.m5Bars].reverse() }),
    [],
  );
  assert.equal(trendlineAtr([]), null);
});
test("a failed M5 retest cannot be rescued by the next rejection candle", () => {
  const x = fixture();
  Object.assign(x.m5Bars.at(-2)!, {
    open: 12.2,
    high: 12.4,
    low: 11,
    close: 11.1,
  });
  assert.deepEqual(previewTrendline(x), []);
});
test("broad confirmation zones and nonfinite quotes are rejected", () => {
  const x = fixture();
  const wide = structuredClone(x);
  wide.m5Bars.at(-1)!.high = 21;
  assert.deepEqual(previewTrendline(wide), []);
  assert.deepEqual(previewTrendline({ ...x, bid: NaN }), []);
});
test("a third point not yet confirmed cannot replace the known anchors", () => {
  const x = fixture();
  // Index 20 has only one later completed candle before the event. Its wick may
  // touch the existing line but cannot become the second anchor of a new line.
  Object.assign(x.setupBars[20], {
    open: 12.6,
    high: 14.2,
    low: 11.4,
    close: 12.6,
  });
  const [p] = previewTrendline(x);
  assert.ok(p);
  assert.deepEqual(p.anchors, [
    x.setupBars[12].opened_at_server_raw,
    x.setupBars[17].opened_at_server_raw,
  ]);
});
