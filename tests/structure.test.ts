import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedPivots, detectStructure } from "../lib/engine/structure";
function bars(values: number[]) {
  return values.map((value, i) => ({
    opened_at_server_raw: 100000 + i * 900,
    open: value,
    close: value,
    high: value + 0.2,
    low: value - 0.2,
    tick_volume: 10,
    real_volume: null,
    spread_points: 20,
  }));
}
test("swing pivots require completed right-hand confirmation and strict extrema", () => {
  const source = bars([10, 11, 14, 12, 11, 10]);
  assert.equal(confirmedPivots(source.slice(0, 4), 2).length, 0);
  assert.equal(confirmedPivots(source, 2)[0].price, 14.2);
  assert.equal(confirmedPivots(source, 2)[0].confirmedIndex, 4);
  assert.equal(confirmedPivots(bars([10, 11, 14, 14, 11, 10]), 2).length, 0);
  assert.throws(() => confirmedPivots(source, 0));
});
test("BOS requires established rising structure and a fresh close above the confirmed high", () => {
  const source = bars([10, 11, 14, 12, 11, 13, 16, 14, 13, 14, 15, 17]);
  const scan = detectStructure(source, 1);
  assert.equal(scan.trend, "up");
  assert.equal(scan.breaks[0].direction, "BUY");
  assert.equal(scan.breaks[0].method, "BOS");
  const wick = structuredClone(source);
  wick.at(-1)!.close = 15;
  wick.at(-1)!.open = 15;
  assert.equal(detectStructure(wick, 1).breaks.length, 0);
});
test("opposite close break in rising structure is CHOCH and mirror is symmetric", () => {
  const source = bars([10, 11, 14, 12, 11, 13, 16, 14, 13, 14, 14, 12]);
  const scan = detectStructure(source, 1);
  assert.equal(scan.breaks[0].direction, "SELL");
  assert.equal(scan.breaks[0].method, "CHOCH");
  const inverted = source.map((b) => ({
    ...b,
    open: 30 - b.open,
    close: 30 - b.close,
    high: 30 - b.low,
    low: 30 - b.high,
  }));
  assert.equal(detectStructure(inverted, 1).breaks[0].direction, "BUY");
  assert.equal(detectStructure(inverted, 1).breaks[0].method, "CHOCH");
});
test("short or non-directional history never fabricates break signals", () => {
  assert.equal(
    detectStructure(bars([10, 11, 12]), 2).status,
    "insufficient_history",
  );
  assert.equal(detectStructure(bars(Array(20).fill(10)), 2).breaks.length, 0);
});
