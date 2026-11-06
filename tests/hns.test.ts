import { test } from "node:test";
import assert from "node:assert/strict";
import { hnsBreaks, hnsRejection, hnsNeckline } from "../lib/engine/hns";
import { hnsFixture } from "./helpers/hns-fixture";
test("HNS SELL and inverse BUY confirm three swings, completed neckline break and M5 rejection", () => {
  for (const buy of [false, true]) {
    const x = hnsFixture(buy);
    const p = hnsBreaks(x.bars, 0.01).at(-1);
    assert.ok(p);
    assert.equal(p.direction, buy ? "BUY" : "SELL");
    assert.equal(hnsRejection(p, x.m5, x.setupEnd, x.server, 0.01), true);
  }
});
test("sloping necklines are projected at the retest instead of treated as horizontal", () => {
  const x = hnsFixture(false, 0.05);
  const p = hnsBreaks(x.bars, 0.01).at(-1);
  assert.ok(p);
  assert.notEqual(
    hnsNeckline(p, p.breakoutOpened),
    hnsNeckline(p, x.m5.at(-1)!.opened_at_server_raw),
  );
  assert.ok(hnsRejection(p, x.m5, x.setupEnd, x.server, 0.01));
});
test("wick-only break, missing right shoulder, flat head and asymmetric shoulders cannot qualify", () => {
  const wick = hnsFixture();
  wick.bars.at(-1)!.close = 95;
  assert.equal(hnsBreaks(wick.bars, 0.01).length, 0);
  const flat = hnsFixture();
  for (const [i, value] of [
    [19, 104],
    [20, 106],
    [21, 104],
  ])
    Object.assign(flat.bars[i], {
      open: value,
      close: value,
      high: value + 0.2,
      low: value - 0.2,
    });
  assert.equal(hnsBreaks(flat.bars, 0.01).length, 0);
  const missing = hnsFixture();
  assert.equal(hnsBreaks(missing.bars.slice(0, 30), 0.01).length, 0);
  const uneven = hnsFixture();
  uneven.bars[28].high = 114;
  assert.equal(hnsBreaks(uneven.bars, 0.01).length, 0);
});
test("weak retest, reclaim of neckline, stale or unfinished M5 confirmation are rejected", () => {
  const x = hnsFixture();
  const p = hnsBreaks(x.bars, 0.01).at(-1)!;
  const weak = structuredClone(x.m5);
  weak.at(-1)!.close = weak.at(-1)!.open;
  assert.equal(hnsRejection(p, weak, x.setupEnd, x.server, 0.01), false);
  const failed = structuredClone(x.m5);
  Object.assign(failed.at(-2)!, { open: 95, high: 96, low: 94, close: 95 });
  assert.equal(hnsRejection(p, failed, x.setupEnd, x.server, 0.01), false);
  assert.equal(hnsRejection(p, x.m5, x.setupEnd, x.server + 301, 0.01), false);
  assert.equal(hnsRejection(p, x.m5, x.setupEnd, x.server - 1, 0.01), false);
});

test("snapshot adapter preserves management, stable identity and requires live evidence", async () => {
  const { hnsSnapshot } = await import("./helpers/hns-fixture");
  const { scanHns } = await import("../lib/engine/hns");
  const { mt5SnapshotSchema } = await import("../lib/engine/mt5");
  const now = Date.now();
  for (const buy of [false, true]) {
    const data = mt5SnapshotSchema.parse(hnsSnapshot(buy, 0, now));
    const plans = scanHns(data, now);
    assert.equal(plans.length, 1);
    const p = plans[0];
    assert.equal(p.method, "HNS");
    assert.equal(p.timeframe, "M15");
    assert.equal(p.direction, buy ? "BUY" : "SELL");
    assert.equal(p.stop, buy ? p.zoneLow - 3 : p.zoneHigh + 3);
    assert.equal(p.config.partialPips, 50);
    assert.equal(p.id, scanHns(data, now)[0].id);
    assert.equal(
      scanHns({ ...data, quote: { ...data.quote, bid: 500, ask: 501 } }, now)
        .length,
      0,
    );
    assert.equal(scanHns(data, now + 120000).length, 0);
    if (!buy) assert.equal(scanHns({ ...data, ask_m5: [] }, now).length, 0);
  }
});

test("live scanner selects HNS once and never depends on future pivot confirmation", async () => {
  const { hnsSnapshot } = await import("./helpers/hns-fixture");
  const { scanLiveAutomatic } = await import("../lib/engine/trendline-live");
  const now = Date.now();
  const snapshot = hnsSnapshot(false, 0, now);
  const plans = scanLiveAutomatic(snapshot, now).plans;
  const hns = plans.find((p) => p.method === "HNS");
  assert.ok(hns);
  assert.equal(
    plans.filter(
      (p) =>
        p.timeframe === hns.timeframe &&
        p.direction === hns.direction &&
        p.confirmationOpenedServer === hns.confirmationOpenedServer,
    ).length,
    1,
  );
  const f = hnsFixture();
  const incomplete = f.bars.slice(0, 30);
  incomplete.at(-1)!.close = 92;
  incomplete.at(-1)!.low = 91.8;
  assert.equal(hnsBreaks(incomplete, 0.01).length, 0);
});
