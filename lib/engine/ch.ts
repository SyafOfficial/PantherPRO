import { createHash } from "node:crypto";
import { confirmedPivots, detectStructure } from "./structure";
import {
  ENGINE_VERSION,
  targetEvidence,
  type AutomaticPlan,
} from "./automatic";
import { inspectMt5Snapshot, snapshotUtc, type mt5SnapshotSchema } from "./mt5";
import { VESTRADO_RULES } from "./config";
import type { z } from "zod";
type Snapshot = z.infer<typeof mt5SnapshotSchema>;
export type ChBar = Pick<
  Snapshot["series"][number]["candles"][number],
  "opened_at_server_raw" | "open" | "high" | "low" | "close"
>;
export const CH_POLICY = Object.freeze({
  version: "ch-v1",
  minCupBars: 12,
  maxCupBars: 120,
  maxBreakAgeBars: 12,
  rimTolerance: 0.2,
  minHandleDepth: 0.1,
  maxHandleDepth: 0.5,
  maxHandleWidth: 0.5,
  rejectionBody: 0.25,
  rejectionClose: 0.65,
});
export type ChPattern = {
  direction: "BUY" | "SELL";
  anchors: [number, number, number, number];
  indices: [number, number, number, number];
  prices: [number, number, number, number];
  breakoutIndex: number;
  breakoutOpened: number;
};
export const chRim = (p: ChPattern, at: number) =>
  p.prices[0] +
  ((p.prices[2] - p.prices[0]) * (at - p.anchors[0])) /
    (p.anchors[2] - p.anchors[0]);
function validBars(bars: ChBar[]) {
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
/** Four confirmed anchors: left rim, rounded base, right rim, shallow handle. */
export function chBreaks(bars: ChBar[], point: number): ChPattern[] {
  if (
    bars.length < 22 ||
    !validBars(bars) ||
    !Number.isFinite(point) ||
    point <= 0
  )
    return [];
  const pivots = confirmedPivots(bars, 2);
  const result: ChPattern[] = [];
  const counts = new Map<number, number>();
  for (const p of pivots)
    counts.set(p.barIndex, (counts.get(p.barIndex) ?? 0) + 1);
  for (
    let i = Math.max(18, bars.length - CH_POLICY.maxBreakAgeBars);
    i < bars.length;
    i++
  ) {
    const known = pivots.filter(
      (p) => p.confirmedIndex < i && counts.get(p.barIndex) === 1,
    );
    let found = false;
    for (const buy of [true, false]) {
      const sign = buy ? 1 : -1;
      const rimKind = buy ? "high" : "low";
      const baseKind = buy ? "low" : "high";
      const extreme = (b: ChBar) => (buy ? b.low : b.high);
      const rims = known.filter((p) => p.kind === rimKind),
        handles = known.filter((p) => p.kind === baseKind);
      for (const right of rims.slice(-12).reverse()) {
        for (const handle of handles
          .filter((p) => p.barIndex >= right.barIndex + 3)
          .slice(-6)
          .reverse()) {
          for (const left of rims
            .filter(
              (p) =>
                right.barIndex - p.barIndex >= 12 &&
                right.barIndex - p.barIndex <= 120,
            )
            .slice(-12)
            .reverse()) {
            const l = left.barIndex,
              r = right.barIndex,
              cupWidth = r - l,
              handleWidth = handle.barIndex - r;
            if (handleWidth > cupWidth * 0.5 || i - r > cupWidth * 0.5 + 3)
              continue;
            let base = l + 1;
            for (let j = l + 1; j < r; j++)
              if (sign * extreme(bars[j]) < sign * extreme(bars[base]))
                base = j;
            if (
              !known.some((p) => p.kind === baseKind && p.barIndex === base) ||
              base - l < cupWidth * 0.25 ||
              base - l > cupWidth * 0.75
            )
              continue;
            const p: ChPattern = {
              direction: buy ? "BUY" : "SELL",
              anchors: [
                left.openedAtServer,
                bars[base].opened_at_server_raw,
                right.openedAtServer,
                handle.openedAtServer,
              ],
              indices: [l, base, r, handle.barIndex],
              prices: [
                left.price,
                extreme(bars[base]),
                right.price,
                handle.price,
              ],
              breakoutIndex: i,
              breakoutOpened: bars[i].opened_at_server_raw,
            };
            const depth = sign * (chRim(p, p.anchors[1]) - p.prices[1]);
            if (
              depth <= point * 4 ||
              Math.abs(left.price - right.price) > depth * 0.2
            )
              continue;
            const handleDepth = sign * (chRim(p, p.anchors[3]) - handle.price);
            if (handleDepth < depth * 0.1 || handleDepth > depth * 0.5)
              continue;
            // A rounded cup spends several bars near its base and descends/recovers on both flanks.
            const broad = bars
              .slice(l + 1, r)
              .filter(
                (b) => sign * (extreme(b) - p.prices[1]) <= depth * 0.25,
              ).length;
            const q1 = bars[l + Math.floor(cupWidth * 0.25)],
              q3 = bars[l + Math.floor(cupWidth * 0.75)];
            if (
              broad < Math.max(3, Math.ceil(cupWidth * 0.15)) ||
              [q1, q3].some(
                (b) =>
                  sign * (chRim(p, b.opened_at_server_raw) - b.close) <
                  depth * 0.6,
              )
            )
              continue;
            if (
              bars
                .slice(l + 1, r)
                .some(
                  (b) =>
                    sign * (b.close - chRim(p, b.opened_at_server_raw)) >
                    point * 2,
                )
            )
              continue;
            // Handle remains shallow throughout, rather than revisiting the cup base.
            if (
              bars
                .slice(r + 1, i)
                .some(
                  (b) =>
                    sign * (chRim(p, b.opened_at_server_raw) - extreme(b)) >
                    depth * 0.5,
                )
            )
              continue;
            const side = (b: ChBar) =>
              sign * (b.close - chRim(p, b.opened_at_server_raw));
            if (
              side(bars[i - 1]) > 0 ||
              side(bars[i]) <= point * 2 ||
              bars.slice(r + 1, i).some((b) => side(b) > point * 2)
            )
              continue;
            result.push(p);
            found = true;
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) break;
    }
  }
  return result;
}
export function chRejection(
  pattern: ChPattern,
  m5: ChBar[],
  setupEnd: number,
  serverTime: number,
  point: number,
) {
  const c = m5.at(-1),
    previous = m5.at(-2);
  if (!c || !previous || !validBars(m5)) return false;
  const buy = pattern.direction === "BUY",
    sign = buy ? 1 : -1;
  if (
    c.opened_at_server_raw < setupEnd ||
    c.opened_at_server_raw + 300 > serverTime ||
    serverTime - (c.opened_at_server_raw + 300) > 300 ||
    previous.opened_at_server_raw + 300 !== c.opened_at_server_raw
  )
    return false;
  const level = chRim(pattern, c.opened_at_server_raw),
    range = c.high - c.low;
  if (
    range <= 0 ||
    c.low > level ||
    c.high < level ||
    sign * (c.close - c.open) < range * CH_POLICY.rejectionBody ||
    (buy ? c.close - c.low : c.high - c.close) / range <
      CH_POLICY.rejectionClose ||
    sign * (c.close - chRim(pattern, c.opened_at_server_raw + 300)) <=
      point * 2 ||
    (buy ? c.close <= previous.high : c.close >= previous.low)
  )
    return false;
  // A completed M5 close reclaiming the neckline invalidates the original break.
  return !m5.some(
    (b) =>
      b !== c &&
      b.opened_at_server_raw >= setupEnd &&
      sign * (b.close - chRim(pattern, b.opened_at_server_raw + 300)) <
        -point * 2,
  );
}
export type ChPlan = AutomaticPlan & {
  ch: { version: "ch-v1"; anchors: ChPattern["anchors"] };
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
export function scanCh(snapshot: Snapshot, now: number): ChPlan[] {
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
  const plans: ChPlan[] = [];
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
    for (const p of chBreaks(bars, snapshot.point)) {
      const buy = p.direction === "BUY",
        sign = buy ? 1 : -1;
      const setupEnd = p.breakoutOpened + seconds[frame];
      if (
        trend !== (buy ? "up" : "down") ||
        !chRejection(p, m5, setupEnd, snapshot.server_time_raw, snapshot.point)
      )
        continue;
      if (
        bars
          .slice(p.breakoutIndex + 1)
          .some(
            (b) =>
              sign *
                (b.close - chRim(p, b.opened_at_server_raw + seconds[frame])) <
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
            CH_POLICY.version,
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
        method: "CH",
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
        reason: `${buy ? "Inverse Cup and Handle" : "Cup and Handle"} ${p.direction}: ${frame} rim breakout with completed M5 retest rejection and ${higher[frame]} alignment. SL follows the existing M5 zone buffer and close rule; BE management at 50 pips. TP1–TP3 use intact M30/H1/H4 structure.`,
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
        ch: { version: "ch-v1", anchors: p.anchors },
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
