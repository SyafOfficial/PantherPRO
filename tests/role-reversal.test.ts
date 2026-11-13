import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lastLevelTouch,
  outsideWick,
  scanRoleReversals,
} from "../lib/engine/role-reversal";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
import { scanLiveAutomatic } from "../lib/engine/trendline-live";
import { roleReversalSnapshot } from "./helpers/role-reversal-fixture";
import { signalSchema } from "../lib/signals";
import { STRATEGIES, STRATEGY_LABELS } from "../lib/strategy";
const scan = (raw: unknown, now: number) =>
  scanRoleReversals(mt5SnapshotSchema.parse(raw), now);

test("SBR SELL / RBS BUY: last pre-break touch, strict one-point stop, large structural risk, existing targets and BE", () => {
  const now = Date.now();
  for (const buy of [true, false]) {
    const raw = roleReversalSnapshot(buy, now),
      p = scan(raw, now).plans[0];
    assert.ok(p);
    assert.equal(p.method, buy ? "RBS" : "SBR");
    assert.equal(p.direction, buy ? "BUY" : "SELL");
    assert.equal(p.stop, buy ? 64.99 : 235.01);
    assert.ok(Math.abs(p.stop - p.entry) > 5); // No 30/50 pip SL cap (zone still <8).
    assert.equal(
      p.roleReversal.reference.opened_at_server_raw,
      raw.series[1].candles[26].opened_at_server_raw,
    );
    assert.notEqual(p.stop, buy ? 59.99 : 240.01); // Older, more extreme touch is ignored.
    assert.equal(p.config.slBufferPips, 0);
    assert.equal(p.config.partialPips, 50);
    assert.equal(p.targetReasons.length, 3);
    assert.ok(p.targetReasons.every((r) => /Intact confirmed/.test(r)));
    assert.ok(buy ? p.stop < p.zoneLow : p.stop > p.zoneHigh);
    const live = scanLiveAutomatic(raw, now).plans.filter(
      (v) =>
        v.timeframe === p.timeframe &&
        v.direction === p.direction &&
        v.confirmationOpenedServer === p.confirmationOpenedServer,
    );
    assert.equal(live.length, 1);
    assert.equal(live[0].method, p.method);
  }
});

test("wick-only breakout, absent retest, weak M5, stale feed, missing ask, wrong-side SL, insufficient TP and unknown HTF fail closed", () => {
  const now = Date.now();
  const cases: Array<
    [string, (s: ReturnType<typeof roleReversalSnapshot>) => void, boolean?]
  > = [
    [
      "wick only",
      (s) => {
        s.series[1].candles.at(-1)!.close = 72;
      },
    ],
    [
      "no retest",
      (s) => {
        s.series[0].candles.at(-1)!.low = 72.3;
      },
    ],
    [
      "weak M5",
      (s) => {
        s.series[0].candles.at(-1)!.close = 72.4;
      },
    ],
    [
      "stale tick",
      (s) => {
        s.quote.last_tick_time_raw -= 61;
        s.quote.last_tick_time_msc_raw -= 61000;
      },
    ],
    [
      "no ask",
      (s) => {
        s.ask_m5 = [];
      },
      false,
    ],
    [
      "SL inside entire zone",
      (s) => {
        Object.assign(s.series[1].candles[26], {
          low: 72.1,
          open: 72.1,
          close: 72.15,
        });
      },
    ],
    [
      "no targets",
      (s) => {
        for (const x of s.series.slice(3, 5)) {
          x.candles = x.candles.slice(-2);
        }
      },
    ],
    [
      "unknown context",
      (s) => {
        for (const b of s.series[2].candles)
          Object.assign(b, { open: 100, close: 100, low: 99, high: 101 });
      },
    ],
    [
      "quote outside zone",
      (s) => {
        s.quote.bid = 75;
        s.quote.ask = 75.1;
      },
    ],
    [
      "entry zone wider than 80 pips",
      (s) => {
        s.series[0].candles.at(-1)!.low = 65.1;
      },
    ],
    [
      "stale confirmation",
      (s) => {
        s.series[0].candles = s.series[0].candles.slice(0, -2);
      },
    ],
  ];
  for (const [name, mutate, buy = true] of cases) {
    const s = roleReversalSnapshot(buy, now);
    mutate(s);
    const result = scan(s, now);
    assert.equal(result.plans.length, 0, name);
    if (!["wick only", "no targets", "stale confirmation"].includes(name))
      assert.ok(result.reasons.length, name);
  }
  assert.equal(
    scan(roleReversalSnapshot(true, now - 31000), now).plans.length,
    0,
  );
});

test("SL reference excludes breakout/retest; missing reference fails; only completed pre-break pivot evidence is used", () => {
  const now = Date.now(),
    s = roleReversalSnapshot(true, now),
    p = scan(s, now).plans[0];
  const bars = s.series[1].candles;
  const reference = lastLevelTouch(
    bars,
    p.roleReversal.anchor,
    p.roleReversal.level,
  );
  assert.deepEqual(reference, p.roleReversal.reference);
  bars.at(-1)!.low = 1; // Breakout wick cannot change the reference.
  assert.deepEqual(
    lastLevelTouch(bars, p.roleReversal.anchor, p.roleReversal.level),
    reference,
  );
  assert.equal(lastLevelTouch(bars, 1, p.roleReversal.level), null);
  assert.equal(lastLevelTouch(bars, p.roleReversal.anchor, 10000), null);
  // Making the last pre-break bar the apparent high requires breakout/future
  // candles to confirm it: detector must retain the old already-confirmed pivot.
  bars[26].high = 78;
  assert.equal(
    scan(s, now).plans[0].roleReversal.anchor,
    p.roleReversal.anchor,
  );
  const unfinished = roleReversalSnapshot(true, now);
  unfinished.series[1].candles.at(-1)!.opened_at_server_raw =
    unfinished.server_time_raw - 800;
  assert.throws(() => scan(unfinished, now), /Unfinished or future bar/);
});

test("later retests keep setup identity and locked stop; new post-break touches never replace it", () => {
  const now = Date.now(),
    s = roleReversalSnapshot(true, now),
    p = scan(s, now).plans[0];
  const next = structuredClone(s),
    old = next.series[0].candles.at(-1)!;
  next.server_time_raw += 300;
  next.quote.last_tick_time_raw += 300;
  next.quote.last_tick_time_msc_raw += 300000;
  next.exported_at_utc = new Date(Math.floor(now / 1000) * 1000 + 300000)
    .toISOString()
    .slice(0, 19)
    .replace(/-/g, ".")
    .replace("T", " ");
  next.series[0].candles.push({
    ...old,
    opened_at_server_raw: old.opened_at_server_raw + 300,
    low: 72.1,
    high: 74.8,
    open: 72.3,
    close: 74.6,
  });
  const later = scan(next, now + 300000).plans[0];
  assert.ok(later);
  assert.equal(later.sourceEventId, p.sourceEventId);
  assert.equal(later.stop, p.stop);
  assert.deepEqual(later.roleReversal.reference, p.roleReversal.reference);
  assert.notEqual(later.confirmationOpenedServer, p.confirmationOpenedServer);
});

test("broker precision and shared UI strategy registry", () => {
  for (const digits of [0, 1, 2, 3, 5, 10])
    for (const wick of [3984, 3984.25, 72.2]) {
      assert.ok(outsideWick(wick, true, digits) < wick);
      assert.ok(outsideWick(wick, false, digits) > wick);
    }
  for (const strategy of ["SBR", "RBS"] as const) {
    assert.ok(STRATEGIES.includes(strategy));
    assert.ok(STRATEGY_LABELS[strategy].includes(strategy));
    const buy = strategy === "RBS";
    assert.ok(
      signalSchema.safeParse({
        instrument: "XAUUSD",
        strategy,
        timeframe: "M15",
        higher_timeframe: "M30",
        direction: buy ? "BUY" : "SELL",
        entry: 100,
        stop_loss: buy ? 90 : 110,
        tp1: buy ? 105 : 95,
        tp2: buy ? 110 : 90,
        tp3: buy ? 115 : 85,
        reasoning: "Completed breakout and retest with structural evidence.",
        access: "public",
      }).success,
    );
  }
});
