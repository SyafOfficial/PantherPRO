import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidate,
  monitor,
  type SetupInput,
  type MonitorState,
} from "../lib/engine/rules";
const at = "2026-10-30T01:00:00Z",
  now = Date.parse(at);
function fixture(): SetupInput {
  return {
    id: "fixture-buy",
    provider: "vestrado-fixture",
    timeframe: "H1",
    method: "BOS",
    direction: "BUY",
    zoneLow: 4000,
    zoneHigh: 4005,
    breakoutLevel: 4002,
    breakout: {
      openedAt: "2026-10-30T00:00:00Z",
      closedAt: "2026-10-30T00:30:00Z",
      open: 4000,
      high: 4008,
      low: 3999,
      close: 4006,
    },
    retestM5: {
      openedAt: "2026-10-30T00:55:00Z",
      closedAt: at,
      open: 4004,
      high: 4006,
      low: 4001,
      close: 4004,
    },
    maximumTarget: 4020,
    maximumTargetReason: "H1 confirmed resistance",
    maximumTargetConfirmedAt: "2026-10-30T00:00:00Z",
    obstacles: [
      {
        price: 4010,
        timeframe: "M5",
        confirmedAt: at,
        reason: "M5 confirmed resistance",
      },
      {
        price: 4015,
        timeframe: "M15",
        confirmedAt: at,
        reason: "M15 confirmed resistance",
      },
    ],
    reason: "H1 bullish structure with completed M5 retest above breakout.",
    config: { pipSize: 0.1, slBufferPips: 30 },
  };
}
function initial(): MonitorState {
  return { lastAt: now - 1, targets: [], partial: false, stopped: false };
}
test("zone width, buffered stop, structural roadblocks and monthly setup remain explicit", () => {
  const raw = fixture(),
    c = buildCandidate(raw, now);
  assert.equal(c.stop, 3997);
  assert.deepEqual(c.targets, [4010, 4015, 4020]);
  assert.equal(c.status, "review_required");
  assert.equal(c.execution, "hypothetical");
  assert.equal(
    buildCandidate({ ...raw, timeframe: "MN1" }, now).timeframe,
    "MN1",
  );
  assert.throws(() => buildCandidate({ ...raw, zoneHigh: 4009 }, now), /width/);
  assert.throws(() =>
    buildCandidate({ ...raw, config: { pipSize: 0.1, slBufferPips: 31 } }, now),
  );
  assert.throws(
    () => buildCandidate({ ...raw, obstacles: [] }, now),
    /never fabricated/,
  );
  assert.throws(
    () =>
      buildCandidate(
        {
          ...raw,
          obstacles: raw.obstacles.map((o) => ({
            ...o,
            confirmedAt: "2026-10-30T02:00:00Z",
          })),
        },
        now,
      ),
    /never fabricated/,
  );
  assert.throws(() => buildCandidate({ ...raw, maximumTarget: 4001 }, now));
});
test("M5 retest rejects unfinished, stale, wrong-duration or reclaimed breakout levels", () => {
  const raw = fixture();
  assert.throws(() => buildCandidate(raw, now - 1));
  assert.throws(() => buildCandidate(raw, now + 300001));
  assert.throws(
    () =>
      buildCandidate(
        {
          ...raw,
          retestM5: { ...raw.retestM5, openedAt: "2026-10-30T00:45:00Z" },
        },
        now,
      ),
    /M5/,
  );
  assert.throws(
    () =>
      buildCandidate(
        { ...raw, retestM5: { ...raw.retestM5, close: 4001 } },
        now,
      ),
    /hold/,
  );
  assert.throws(
    () =>
      buildCandidate(
        { ...raw, breakout: { ...raw.breakout, close: 4001 } },
        now,
      ),
    /Breakout/,
  );
});
test("BUY wick sweep does not trigger SL; strict M5 close below does and blocks later events", () => {
  const c = buildCandidate(fixture(), now),
    t = now + 300000,
    stamp = new Date(t).toISOString();
  const candle = {
    openedAt: at,
    closedAt: stamp,
    open: 4000,
    high: 4001,
    low: 3995,
    close: 3997,
  };
  const sweep = monitor(
    c,
    initial(),
    { kind: "m5", provider: c.provider, at: stamp, priceBasis: "bid", candle },
    t,
  );
  assert.equal(sweep.state.stopped, false);
  assert.deepEqual(
    sweep.events.map((e) => e.kind),
    ["sweep"],
  );
  const stop = monitor(
    c,
    initial(),
    {
      kind: "m5",
      provider: c.provider,
      at: stamp,
      priceBasis: "bid",
      candle: { ...candle, close: 3996 },
    },
    t,
  );
  assert.equal(stop.state.stopped, true);
  assert.deepEqual(
    stop.events.map((e) => e.kind),
    ["sl"],
  );
  assert.equal(
    monitor(
      c,
      stop.state,
      {
        kind: "quote",
        provider: c.provider,
        at: new Date(t + 1).toISOString(),
        bid: 4021,
        ask: 4022,
      },
      t + 1,
    ).events.length,
    0,
  );
});
test("quote target events use bid exits, partial strictly exceeds 50 pips and state deduplicates", () => {
  const c = buildCandidate(fixture(), now),
    q = {
      kind: "quote" as const,
      provider: c.provider,
      at,
      bid: 4010,
      ask: 4011,
    };
  const a = monitor(c, initial(), q, now);
  assert.deepEqual(
    a.events.map((e) => e.kind),
    ["tp1"],
  );
  assert.equal(monitor(c, a.state, q, now).events.length, 0);
  const b = monitor(
    c,
    a.state,
    { ...q, at: new Date(now + 1).toISOString(), bid: 4010.1, ask: 4011 },
    now + 1,
  );
  assert.equal(b.events[0].message, "Close Partial and SET Break Even now!");
  const d = monitor(
    c,
    b.state,
    { ...q, at: new Date(now + 2).toISOString(), bid: 4020, ask: 4021 },
    now + 2,
  );
  assert.deepEqual(
    d.events.map((e) => e.kind),
    ["tp2", "tp3"],
  );
  assert.equal(
    new Set([...a.events, ...b.events, ...d.events].map((e) => e.id)).size,
    4,
  );
});
test("SELL mirrors stops and uses ask, not bid, for target observations", () => {
  const raw = fixture();
  raw.direction = "SELL";
  raw.breakout.close = 4001;
  raw.retestM5.close = 4001;
  raw.retestM5.open = 4001;
  raw.maximumTarget = 3980;
  raw.obstacles = raw.obstacles.map((o, i) => ({ ...o, price: 3995 - i * 5 }));
  const c = buildCandidate(raw, now);
  assert.equal(c.stop, 4008);
  const q = {
    kind: "quote" as const,
    provider: c.provider,
    at,
    bid: 3994,
    ask: 3996,
  };
  assert.equal(monitor(c, initial(), q, now).events.length, 0);
  assert.deepEqual(
    monitor(c, initial(), { ...q, ask: 3995 }, now).events.map((e) => e.kind),
    ["tp1"],
  );
  const t = now + 300000,
    stamp = new Date(t).toISOString(),
    candle = {
      openedAt: at,
      closedAt: stamp,
      open: 4005,
      high: 4010,
      low: 4004,
      close: 4009,
    };
  assert.equal(
    monitor(
      c,
      initial(),
      {
        kind: "m5",
        provider: c.provider,
        at: stamp,
        priceBasis: "ask",
        candle,
      },
      t,
    ).events[0].kind,
    "sl",
  );
  assert.throws(() =>
    monitor(
      c,
      initial(),
      {
        kind: "m5",
        provider: c.provider,
        at: stamp,
        priceBasis: "bid",
        candle,
      },
      t,
    ),
  );
});
test("future, stale, mixed-source and inverted observations fail closed", () => {
  const c = buildCandidate(fixture(), now),
    q = {
      kind: "quote" as const,
      provider: c.provider,
      at,
      bid: 4005,
      ask: 4006,
    };
  assert.throws(() => monitor(c, initial(), q, now - 1));
  assert.throws(() => monitor(c, initial(), q, now + 60001));
  assert.throws(() =>
    monitor(c, initial(), { ...q, provider: "another-source" }, now),
  );
  assert.throws(() => monitor(c, initial(), { ...q, ask: 4000 }, now));
});
test("a quote at candle-close time cannot suppress the M5 stop event", () => {
  const c = buildCandidate(fixture(), now),
    t = now + 300000,
    stamp = new Date(t).toISOString();
  const a = monitor(
    c,
    initial(),
    { kind: "quote", provider: c.provider, at: stamp, bid: 3996, ask: 3997 },
    t,
  );
  const b = monitor(
    c,
    a.state,
    {
      kind: "m5",
      provider: c.provider,
      at: stamp,
      priceBasis: "bid",
      candle: {
        openedAt: at,
        closedAt: stamp,
        open: 4000,
        high: 4001,
        low: 3995,
        close: 3996,
      },
    },
    t,
  );
  assert.equal(b.events[0].kind, "sl");
});
test("M5 and daily are not setup frames; liquidity is not fabricated from missing evidence", () => {
  for (const timeframe of ["M5", "D1"])
    assert.throws(() =>
      buildCandidate({ ...fixture(), timeframe } as SetupInput, now),
    );
  assert.equal("liquidity" in buildCandidate(fixture(), now), false);
});
import { VESTRADO_RULES, priceDistance } from "../lib/engine/config";
test("owner-confirmed pip distances are independent of client lots and do not enable automatic publication", () => {
  assert.equal(priceDistance(50), 5);
  assert.equal(priceDistance(VESTRADO_RULES.maxZonePips), 8);
  assert.equal(priceDistance(VESTRADO_RULES.slBufferPips), 3);
  assert.equal(VESTRADO_RULES.stopConfirmation, "M5_CLOSE");
  assert.equal(VESTRADO_RULES.autoPublish, false);
  assert.throws(() => priceDistance(NaN));
  assert.throws(() => priceDistance(-1));
});
