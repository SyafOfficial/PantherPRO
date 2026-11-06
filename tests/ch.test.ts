import { test } from "node:test";
import assert from "node:assert/strict";
import { chBreaks, chRejection, scanCh } from "../lib/engine/ch";
import { chFixture, chSnapshot } from "./helpers/ch-fixture";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
test("CH normal BUY and inverse SELL require completed cup, shallow handle, rim break and M5 rejection", () => {
  for (const buy of [true, false])
    for (const slope of [0, 0.04]) {
      const f = chFixture(buy, slope),
        p = chBreaks(f.bars, 0.01).at(-1);
      assert.ok(p, `${buy} ${slope}`);
      assert.equal(p.direction, buy ? "BUY" : "SELL");
      assert.equal(chRejection(p, f.m5, f.setupEnd, f.server, 0.01), true);
    }
});
test("CH rejects deep handles, absent handles and wick-only breaks", () => {
  const f = chFixture();
  f.bars.at(-1)!.close = 105;
  assert.equal(chBreaks(f.bars, 0.01).length, 0);
  const deep = chFixture();
  deep.bars[37].low = 90;
  assert.equal(chBreaks(deep.bars, 0.01).length, 0);
  assert.equal(chBreaks(chFixture().bars.slice(0, 34), 0.01).length, 0);
});
test("CH adapter preserves structural targets, fixed management and live evidence", () => {
  const now = Date.now();
  for (const buy of [true, false]) {
    const s = mt5SnapshotSchema.parse(chSnapshot(buy, 0, now)),
      plans = scanCh(s, now);
    assert.equal(plans.length, 1);
    const p = plans[0];
    assert.equal(p.method, "CH");
    assert.equal(p.config.partialPips, 50);
    assert.equal(p.stop, buy ? p.zoneLow - 3 : p.zoneHigh + 3);
    assert.equal(p.id, scanCh(s, now)[0].id);
    assert.equal(scanCh(s, now + 120000).length, 0);
    if (!buy) assert.equal(scanCh({ ...s, ask_m5: [] }, now).length, 0);
  }
});

test("CH rejects a sharp V base, failed retest, incomplete confirmation and duplicate method alerts", async () => {
  const f = chFixture();
  for (let i = 8; i < 33; i++) {
    const v = 85 + (21 * Math.abs(i - 20)) / 13;
    Object.assign(f.bars[i], {
      open: v,
      close: v,
      high: v + 0.2,
      low: v - 0.2,
    });
  }
  assert.equal(chBreaks(f.bars, 0.01).length, 0);
  const valid = chFixture();
  const pattern = chBreaks(valid.bars, 0.01)[0];
  assert.equal(
    chRejection(pattern, valid.m5, valid.setupEnd, valid.server - 1, 0.01),
    false,
  );
  const reclaim = structuredClone(valid.m5);
  Object.assign(reclaim.at(-2)!, {
    open: 104,
    close: 104,
    high: 105,
    low: 103,
  });
  assert.equal(
    chRejection(pattern, reclaim, valid.setupEnd, valid.server, 0.01),
    false,
  );
  const { scanLiveAutomatic } = await import("../lib/engine/trendline-live");
  const now = Date.now();
  const plans = scanLiveAutomatic(chSnapshot(true, 0, now), now).plans;
  const ch = plans.find((p) => p.method === "CH");
  assert.ok(ch);
  assert.equal(
    plans.filter(
      (p) =>
        p.timeframe === ch.timeframe &&
        p.direction === ch.direction &&
        p.confirmationOpenedServer === ch.confirmationOpenedServer,
    ).length,
    1,
  );
});
