import { createHash } from "node:crypto";
import { confirmedPivots, detectStructure, type Pivot } from "./structure";
import {
  ENGINE_VERSION,
  targetEvidence,
  type AutomaticPlan,
} from "./automatic";
import { inspectMt5Snapshot, snapshotUtc, type mt5SnapshotSchema } from "./mt5";
import { VESTRADO_RULES } from "./config";
import type { z } from "zod";
type Snapshot = z.infer<typeof mt5SnapshotSchema>;
export type HnsBar = Pick<
  Snapshot["series"][number]["candles"][number],
  "opened_at_server_raw" | "open" | "high" | "low" | "close"
>;
export const HNS_POLICY = Object.freeze({
  version: "hns-v1",
  pivotStrength: 2,
  minPivotSpacing: 3,
  maxPatternBars: 120,
  maxBreakAgeBars: 12,
  shoulderTolerance: 0.35,
  headProminence: 0.1,
  maxNeckTilt: 0.5,
  minWidthRatio: 0.4,
  maxWidthRatio: 2.5,
  rejectionBody: 0.25,
  rejectionClose: 0.65,
});
export type HnsPattern = {
  direction: "BUY" | "SELL";
  anchors: [number, number, number, number, number];
  indices: [number, number, number, number, number];
  prices: [number, number, number, number, number];
  breakoutIndex: number;
  breakoutOpened: number;
};
export const hnsNeckline = (p: HnsPattern, at: number) =>
  p.prices[1] +
  ((p.prices[3] - p.prices[1]) * (at - p.anchors[1])) /
    (p.anchors[3] - p.anchors[1]);
function validBars(bars: HnsBar[]) {
  return bars.every(
    (b, i) =>
      [b.opened_at_server_raw, b.open, b.high, b.low, b.close].every(
        Number.isFinite,
      ) &&
      b.low > 0 &&
      b.low <= Math.min(b.open, b.close) &&
      b.high >= Math.max(b.open, b.close) &&
      (!i || b.opened_at_server_raw > bars[i - 1].opened_at_server_raw),
  );
}
function alternating(pivots: Pivot[]) {
  const result: Pivot[] = [];
  for (const p of pivots) {
    if (pivots.some((q) => q !== p && q.barIndex === p.barIndex)) continue;
    const last = result.at(-1);
    if (last?.kind === p.kind) {
      if (p.kind === "high" ? p.price > last.price : p.price < last.price)
        result[result.length - 1] = p;
    } else result.push(p);
  }
  return result.slice(-48);
}
/** Only pivots confirmed before the breakout enter a pattern. No measured-move TP. */
export function hnsBreaks(bars: HnsBar[], point: number): HnsPattern[] {
  if (
    bars.length < 20 ||
    !validBars(bars) ||
    !Number.isFinite(point) ||
    point <= 0
  )
    return [];
  const pivots = confirmedPivots(bars, HNS_POLICY.pivotStrength);
  const result: HnsPattern[] = [];
  for (
    let i = Math.max(14, bars.length - HNS_POLICY.maxBreakAgeBars);
    i < bars.length;
    i++
  ) {
    const known = alternating(pivots.filter((p) => p.confirmedIndex < i));
    for (let k = known.length - 5; k >= 0; k--) {
      const p = known.slice(k, k + 5);
      const buy = p[0].kind === "low";
      if (
        p.some(
          (a, j) =>
            a.kind !==
            (j % 2 === 0 ? (buy ? "low" : "high") : buy ? "high" : "low"),
        )
      )
        continue;
      const indices = p.map((a) => a.barIndex) as HnsPattern["indices"];
      if (
        indices.some(
          (n, j) => j > 0 && n - indices[j - 1] < HNS_POLICY.minPivotSpacing,
        ) ||
        indices[4] - indices[0] > HNS_POLICY.maxPatternBars ||
        indices[0] < 5
      )
        continue;
      const pattern: HnsPattern = {
        direction: buy ? "BUY" : "SELL",
        anchors: p.map((a) => a.openedAtServer) as HnsPattern["anchors"],
        indices,
        prices: p.map((a) => a.price) as HnsPattern["prices"],
        breakoutIndex: i,
        breakoutOpened: bars[i].opened_at_server_raw,
      };
      const canonical = (v: number) => (buy ? -v : v);
      const height = canonical(
        p[2].price - hnsNeckline(pattern, p[2].openedAtServer),
      );
      const prominence =
        canonical(p[2].price) -
        Math.max(canonical(p[0].price), canonical(p[4].price));
      const width = (indices[2] - indices[0]) / (indices[4] - indices[2]);
      if (
        height <= point * 4 ||
        prominence < height * HNS_POLICY.headProminence ||
        Math.abs(p[0].price - p[4].price) >
          height * HNS_POLICY.shoulderTolerance ||
        Math.abs(p[1].price - p[3].price) > height * HNS_POLICY.maxNeckTilt ||
        width < HNS_POLICY.minWidthRatio ||
        width > HNS_POLICY.maxWidthRatio
      )
        continue;
      // Both shoulders must stand above the neckline in canonical orientation.
      if (
        [0, 4].some(
          (j) =>
            canonical(p[j].price - hnsNeckline(pattern, p[j].openedAtServer)) <
            height * 0.2,
        )
      )
        continue;
      const lead = bars[Math.max(0, indices[0] - 12)].close;
      if (canonical(p[0].price - lead) < height * 0.5) continue;
      const tolerance = point * 2;
      const inside = (b: HnsBar) =>
        canonical(b.close - hnsNeckline(pattern, b.opened_at_server_raw));
      if (inside(bars[i - 1]) < 0 || inside(bars[i]) >= -tolerance) continue;
      if (bars.slice(indices[4] + 1, i).some((b) => inside(b) < -tolerance))
        continue;
      result.push(pattern);
      break;
    }
  }
  return result;
}
export function hnsRejection(
  pattern: HnsPattern,
  m5: HnsBar[],
  setupEnd: number,
  serverTime: number,
  point: number,
) {
  return levelRetestRejection(
    (at) => hnsNeckline(pattern, at),
    pattern.direction === "BUY",
    m5,
    setupEnd,
    serverTime,
    point,
  );
}
/** Shared completed-M5 level rejection; HNS uses its sloped neckline. */
export function levelRetestRejection(
  levelAt: (at: number) => number,
  buy: boolean,
  m5: HnsBar[],
  setupEnd: number,
  serverTime: number,
  point: number,
) {
  const c = m5.at(-1),
    previous = m5.at(-2);
  if (!c || !previous || !validBars(m5)) return false;
  const sign = buy ? 1 : -1;
  if (
    c.opened_at_server_raw < setupEnd ||
    c.opened_at_server_raw + 300 > serverTime ||
    serverTime - (c.opened_at_server_raw + 300) > 300 ||
    previous.opened_at_server_raw + 300 !== c.opened_at_server_raw
  )
    return false;
  const level = levelAt(c.opened_at_server_raw),
    range = c.high - c.low;
  if (
    range <= 0 ||
    c.low > level ||
    c.high < level ||
    sign * (c.close - c.open) < range * HNS_POLICY.rejectionBody ||
    (buy ? c.close - c.low : c.high - c.close) / range <
      HNS_POLICY.rejectionClose ||
    sign * (c.close - levelAt(c.opened_at_server_raw + 300)) <= point * 2 ||
    (buy ? c.close <= previous.high : c.close >= previous.low)
  )
    return false;
  // A completed M5 close reclaiming the neckline invalidates the original break.
  return !m5.some(
    (b) =>
      b !== c &&
      b.opened_at_server_raw >= setupEnd &&
      sign * (b.close - levelAt(b.opened_at_server_raw + 300)) < -point * 2,
  );
}
export type HnsPlan = AutomaticPlan & {
  hns: { version: "hns-v1"; anchors: HnsPattern["anchors"] };
};
const frames = ["M15", "M30", "H1", "H4"] as const;
const higher = { M15: "M30", M30: "H1", H1: "H4", H4: "W1" } as const;
const seconds: Record<string, number> = {
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  W1: 604800,
};
/** Runs inside the existing snapshot scan. No extra database fetches or timers. */
export function scanHns(snapshot: Snapshot, now: number): HnsPlan[] {
  if (!inspectMt5Snapshot(snapshot, now).freshness.usableCurrentQuote)
    return [];
  const m5 = snapshot.series
    .find((s) => s.timeframe === "M5")!
    .candles.filter(
      (b) => b.opened_at_server_raw + 300 <= snapshot.server_time_raw,
    );
  const c = m5.at(-1);
  if (!c || snapshot.server_time_raw - (c.opened_at_server_raw + 300) > 300)
    return [];
  const plans: HnsPlan[] = [];
  for (const frame of frames) {
    const bars = snapshot.series
      .find((s) => s.timeframe === frame)!
      .candles.filter(
        (b) =>
          b.opened_at_server_raw + seconds[frame] <= c.opened_at_server_raw,
      );
    const context = snapshot.series
      .find((s) => s.timeframe === higher[frame])!
      .candles.filter(
        (b) =>
          b.opened_at_server_raw + seconds[higher[frame]] <=
          c.opened_at_server_raw + 300,
      );
    const trend = detectStructure(context).trend;
    for (const p of hnsBreaks(bars, snapshot.point)) {
      const buy = p.direction === "BUY",
        sign = buy ? 1 : -1;
      const setupEnd = p.breakoutOpened + seconds[frame];
      if (
        trend !== (buy ? "up" : "down") ||
        !hnsRejection(p, m5, setupEnd, snapshot.server_time_raw, snapshot.point)
      )
        continue;
      if (
        bars
          .slice(p.breakoutIndex + 1)
          .some(
            (b) =>
              sign *
                (b.close -
                  hnsNeckline(p, b.opened_at_server_raw + seconds[frame])) <
              -snapshot.point * 2,
          )
      )
        continue;
      const entry = buy ? snapshot.quote.ask : snapshot.quote.bid;
      if (
        entry < c.low ||
        entry > c.high ||
        c.high - c.low > VESTRADO_RULES.maxZonePips * VESTRADO_RULES.pipSize ||
        (!buy &&
          !(snapshot.ask_m5 ?? []).some(
            (b) => b.opened_at_server_raw === c.opened_at_server_raw,
          ))
      )
        continue;
      const targets = targetEvidence(
        snapshot,
        frame,
        buy,
        c.low,
        c.high,
        c.opened_at_server_raw + 300,
      );
      if (!targets) continue;
      const id = createHash("sha256")
        .update(
          [
            HNS_POLICY.version,
            snapshot.symbol,
            frame,
            p.direction,
            ...p.anchors,
          ].join(":"),
        )
        .digest("hex");
      plans.push({
        id,
        sourceEventId: id,
        provider: snapshot.provider,
        method: "HNS",
        timeframe: frame,
        higherTimeframe: higher[frame],
        direction: p.direction,
        zoneLow: c.low,
        zoneHigh: c.high,
        entry,
        stop:
          (buy ? c.low : c.high) -
          sign * VESTRADO_RULES.slBufferPips * VESTRADO_RULES.pipSize,
        targets: [
          targets.obstacles[0].price,
          targets.obstacles[1].price,
          targets.maximumTarget,
        ],
        targetReasons: [
          ...targets.obstacles.map((o) => o.reason),
          targets.maximumTargetReason,
        ],
        reason: `${buy ? "Inverse HNS" : "Head and Shoulders"} ${p.direction}: ${frame} neckline break with completed M5 retest rejection and ${higher[frame]} alignment. SL follows the existing M5 zone buffer and close rule; BE management at 50 pips. TP1–TP3 use intact M30/H1/H4 structure.`,
        config: {
          pipSize: 0.1,
          maxZonePips: 80,
          slBufferPips: 30,
          partialPips: 50,
        },
        status: "policy_candidate",
        execution: "hypothetical",
        confirmedAt: new Date(
          snapshotUtc(snapshot.exported_at_utc),
        ).toISOString(),
        confirmationOpenedServer: c.opened_at_server_raw,
        breakoutOpenedServer: p.breakoutOpened,
        version: ENGINE_VERSION,
        tickVolumeRatio: null,
        hns: { version: "hns-v1", anchors: p.anchors },
      });
    }
  }
  const seen = new Set<string>();
  return plans.filter((p) => {
    const key = `${p.timeframe}:${p.direction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
