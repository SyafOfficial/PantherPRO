import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  originBase,
  baseRejection,
  scanBaseRetests,
  type BaseBar,
} from "../lib/engine/base-retest";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
import { baseSnapshot } from "./helpers/base-fixture";
test("Nov 12 M30 CHOCH uses the original two-candle body and its full wick, rejecting the early M5 zone", async () => {
  const rows = JSON.parse(
    await readFile("tests/helpers/choch-m30-replay.json", "utf8"),
  ) as { timeframe: string; bars: BaseBar[] }[];
  const bars = rows.find((r) => r.timeframe === "M30")!.bars,
    m5 = rows.find((r) => r.timeframe === "M5")!.bars;
  const index = bars.findIndex((b) => b.opened_at_server_raw === 1794466800),
    base = originBase(bars, index, false, 3973.9, 0.01);
  assert.ok(base);
  assert.equal(base.zoneLow, 3980.42);
  assert.equal(base.zoneHigh, 3982.78);
  assert.equal(base.wickHigh, 3984.99);
  assert.equal(
    baseRejection(
      base,
      m5.filter((b) => b.opened_at_server_raw <= 1794469200),
      1794468600,
      1794469500,
      0.01,
      false,
    ),
    false,
  );
  assert.equal(
    baseRejection(
      base,
      m5.filter((b) => b.opened_at_server_raw <= 1794470100),
      1794468600,
      1794470400,
      0.01,
      false,
    ),
    true,
  );
});
test("live BOS and CHOCH require origin-base retest, completed directional rejection, quote inside base and exact wick stop", () => {
  const now = Date.now();
  for (const buy of [true, false])
    for (const choch of [false, true]) {
      const s = mt5SnapshotSchema.parse(baseSnapshot(buy, choch, now)),
        p = scanBaseRetests(s, now).find((p) => p.timeframe === "M15");
      assert.ok(p, `${buy} ${choch}`);
      assert.equal(p.method, choch ? "CHOCH" : "BOS");
      assert.equal(p.direction, buy ? "BUY" : "SELL");
      assert.equal(p.stop, buy ? (choch ? 80.2 : 70.2) : choch ? 219.8 : 229.8);
      assert.equal(p.config.slBufferPips, 0);
      assert.equal(p.config.partialPips, 50);
      assert.equal(
        scanBaseRetests(
          { ...s, quote: { ...s.quote, bid: 50, ask: 50.1 } },
          now,
        ).length,
        0,
      );
      const weak = structuredClone(s);
      weak.series[0].candles.at(-1)!.close =
        weak.series[0].candles.at(-1)!.open;
      assert.equal(scanBaseRetests(weak, now).length, 0);
      if (!buy)
        assert.equal(scanBaseRetests({ ...s, ask_m5: [] }, now).length, 0);
    }
});

test("base entry rejects price still inside the M5 candle but outside the origin, failed base, weak departure and unfinished break", () => {
  const now = Date.now(),
    s = mt5SnapshotSchema.parse(baseSnapshot(true, false, now));
  assert.equal(
    scanBaseRetests({ ...s, quote: { ...s.quote, bid: 71, ask: 71.1 } }, now)
      .length,
    0,
  );
  const failed = structuredClone(s);
  Object.assign(failed.series[0].candles.at(-2)!, { close: 70.2, low: 70.2 });
  assert.equal(scanBaseRetests(failed, now).length, 0);
  const weak = structuredClone(s);
  weak.series[1].candles.at(-1)!.open = 73.9;
  assert.equal(scanBaseRetests(weak, now).length, 0);
  const unfinished = structuredClone(s);
  unfinished.series[1].candles.at(-1)!.opened_at_server_raw =
    unfinished.server_time_raw - 900;
  assert.equal(scanBaseRetests(unfinished, now).length, 0);
  const unknown = structuredClone(s);
  for (const b of unknown.series[2].candles)
    Object.assign(b, { open: 100, close: 100, high: 101, low: 99 });
  assert.equal(scanBaseRetests(unknown, now).length, 0);
});

test("live scanner cannot leak the legacy M5 zone for BOS/CHOCH", async () => {
  const { scanLiveAutomatic } = await import("../lib/engine/trendline-live");
  const now = Date.now(),
    s = baseSnapshot(true, false, now),
    plans = scanLiveAutomatic(s, now).plans;
  const p = plans.find((p) => p.method === "BOS");
  assert.ok(p);
  assert.equal(p.zoneHigh, 70.8);
  assert.equal(p.stop, 70.2);
  for (const plan of plans.filter((p) => ["BOS", "CHOCH"].includes(p.method)))
    assert.ok("base" in plan);
});
