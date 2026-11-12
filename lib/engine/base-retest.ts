import { createHash } from "node:crypto";
import { detectStructure } from "./structure";
import {
  ENGINE_VERSION,
  targetEvidence,
  type AutomaticPlan,
} from "./automatic";
import { inspectMt5Snapshot, snapshotUtc, type mt5SnapshotSchema } from "./mt5";
import { VESTRADO_RULES } from "./config";
import { TIMEFRAMES } from "../strategy";
import type { z } from "zod";
type Snapshot = z.infer<typeof mt5SnapshotSchema>;
export type BaseBar = Pick<
  Snapshot["series"][number]["candles"][number],
  "opened_at_server_raw" | "open" | "high" | "low" | "close"
>;
export const BASE_RETEST_VERSION = "structure-base-v2";
export type OriginBase = {
  start: number;
  end: number;
  departure: number;
  zoneLow: number;
  zoneHigh: number;
  wickLow: number;
  wickHigh: number;
};
export function originBase(
  bars: BaseBar[],
  breakIndex: number,
  buy: boolean,
  level: number,
  point: number,
): OriginBase | null {
  const sign = buy ? 1 : -1;
  let end = breakIndex - 1;
  if (
    !bars[breakIndex] ||
    sign * (bars[breakIndex].close - bars[breakIndex].open) <= 0
  )
    return null;
  while (
    end >= Math.max(0, breakIndex - 6) &&
    sign * (bars[end].close - bars[end].open) >= 0
  )
    end--;
  if (end < Math.max(0, breakIndex - 6)) return null;
  let start = end;
  while (
    start > 0 &&
    sign * (bars[start - 1].close - bars[start - 1].open) < 0 &&
    end - start < 2
  )
    start--;
  if (end - start >= 2) return null;
  const base = bars.slice(start, end + 1),
    departure = bars[end + 1];
  if (
    base.some(
      (b) =>
        b.high <= b.low || Math.abs(b.close - b.open) > (b.high - b.low) * 0.5,
    )
  )
    return null;
  const zoneLow = Math.min(...base.map((b) => Math.min(b.open, b.close))),
    zoneHigh = Math.max(...base.map((b) => Math.max(b.open, b.close)));
  const wickLow = Math.min(...base.map((b) => b.low)),
    wickHigh = Math.max(...base.map((b) => b.high));
  if (
    zoneLow >= zoneHigh ||
    (buy ? zoneHigh >= level - point : zoneLow <= level + point)
  )
    return null;
  if (
    base.length > 1 &&
    Math.max(...base.map((b) => b.low)) > Math.min(...base.map((b) => b.high))
  )
    return null;
  if (
    !departure ||
    sign * (departure.close - departure.open) <
      (departure.high - departure.low) * 0.6 ||
    (buy ? departure.close <= zoneHigh : departure.close >= zoneLow)
  )
    return null;
  if (
    bars
      .slice(end + 1, breakIndex + 1)
      .some((b) => (buy ? b.close <= zoneLow : b.close >= zoneHigh))
  )
    return null;
  return {
    start,
    end,
    departure: end + 1,
    zoneLow,
    zoneHigh,
    wickLow,
    wickHigh,
  };
}
export function baseRejection(
  base: OriginBase,
  m5: BaseBar[],
  breakEnd: number,
  server: number,
  point: number,
  buy: boolean,
) {
  const c = m5.at(-1);
  if (
    !c ||
    c.opened_at_server_raw < breakEnd ||
    server - (c.opened_at_server_raw + 300) < 0 ||
    server - (c.opened_at_server_raw + 300) > 300
  )
    return false;
  const sign = buy ? 1 : -1,
    range = c.high - c.low;
  if (
    range <= 0 ||
    c.low > base.zoneHigh ||
    c.high < base.zoneLow ||
    sign * (c.close - c.open) < range * 0.25 ||
    (buy ? c.close - c.low : c.high - c.close) / range < 0.65 ||
    (buy
      ? c.close <= base.zoneHigh + point * 2
      : c.close >= base.zoneLow - point * 2)
  )
    return false;
  return !m5.some(
    (b) =>
      b.opened_at_server_raw >= breakEnd &&
      b.opened_at_server_raw <= c.opened_at_server_raw &&
      (buy ? b.close <= base.wickLow : b.close >= base.wickHigh),
  );
}
const seconds: Record<string, number> = {
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  W1: 604800,
};
export function baseBarEnd(b: BaseBar, frame: string) {
  if (frame === "MN1") {
    const d = new Date(b.opened_at_server_raw * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return b.opened_at_server_raw + seconds[frame];
}
export type BasePlan = AutomaticPlan & {
  base: {
    version: typeof BASE_RETEST_VERSION;
    start: number;
    end: number;
    departure: number;
    level: number;
    anchor: number;
  };
};
export function scanBaseRetests(s: Snapshot, now: number): BasePlan[] {
  if (!inspectMt5Snapshot(s, now).freshness.usableCurrentQuote) return [];
  const m5 = s.series
      .find((v) => v.timeframe === "M5")!
      .candles.filter((b) => b.opened_at_server_raw + 300 <= s.server_time_raw),
    c = m5.at(-1);
  if (!c || s.server_time_raw - c.opened_at_server_raw - 300 > 300) return [];
  const plans: BasePlan[] = [];
  for (const [fi, frame] of TIMEFRAMES.entries()) {
    const bars = s.series
        .find((v) => v.timeframe === frame)!
        .candles.filter((b) => baseBarEnd(b, frame) <= c.opened_at_server_raw),
      higher = TIMEFRAMES[fi + 1] ?? null;
    const trend = higher
      ? detectStructure(
          s.series
            .find((v) => v.timeframe === higher)!
            .candles.filter(
              (b) => baseBarEnd(b, higher) <= c.opened_at_server_raw + 300,
            ),
        ).trend
      : null;
    for (
      let index = bars.length - 1;
      index >= Math.max(14, bars.length - 12);
      index--
    ) {
      const structure = detectStructure(bars.slice(0, index + 1));
      for (const trigger of structure.breaks) {
        const buy = trigger.direction === "BUY";
        if (higher && trend !== (buy ? "up" : "down")) continue;
        const base = originBase(bars, index, buy, trigger.level, s.point);
        if (
          !base ||
          !baseRejection(
            base,
            m5,
            baseBarEnd(bars[index], frame),
            s.server_time_raw,
            s.point,
            buy,
          )
        )
          continue;
        if (
          bars
            .slice(index + 1)
            .some((b) =>
              buy ? b.close <= base.wickLow : b.close >= base.wickHigh,
            )
        )
          continue;
        const entry = buy ? s.quote.ask : s.quote.bid,
          stop = buy ? base.wickLow : base.wickHigh;
        if (
          entry < base.zoneLow ||
          entry > base.zoneHigh ||
          (buy ? entry <= stop : entry >= stop) ||
          base.zoneHigh - base.zoneLow >
            VESTRADO_RULES.maxZonePips * VESTRADO_RULES.pipSize
        )
          continue;
        if (
          !buy &&
          !(s.ask_m5 ?? []).some(
            (b) => b.opened_at_server_raw === c.opened_at_server_raw,
          )
        )
          continue;
        const targets = targetEvidence(
          s,
          frame,
          buy,
          base.zoneLow,
          base.zoneHigh,
          c.opened_at_server_raw + 300,
        );
        if (!targets) continue;
        const id = createHash("sha256")
          .update(
            [
              BASE_RETEST_VERSION,
              s.symbol,
              frame,
              trigger.method,
              trigger.direction,
              trigger.pivot.openedAtServer,
              bars[index].opened_at_server_raw,
              bars[base.start].opened_at_server_raw,
            ].join(":"),
          )
          .digest("hex");
        plans.push({
          id,
          sourceEventId: id,
          provider: s.provider,
          method: trigger.method,
          timeframe: frame,
          higherTimeframe: higher,
          direction: trigger.direction,
          zoneLow: base.zoneLow,
          zoneHigh: base.zoneHigh,
          entry,
          stop,
          targets: [
            targets.obstacles[0].price,
            targets.obstacles[1].price,
            targets.maximumTarget,
          ],
          targetReasons: [
            ...targets.obstacles.map((v) => v.reason),
            targets.maximumTargetReason,
          ],
          reason: `${trigger.method} ${frame} ${trigger.direction}: completed structure break, return to original setup base ${base.zoneLow}-${base.zoneHigh}, then completed M5 rejection. SL at the original base wick ${stop}; BE at 50 pips. TP1–TP3 follow intact M30/H1/H4 structure.`,
          config: {
            pipSize: 0.1,
            maxZonePips: 80,
            slBufferPips: 0,
            partialPips: 50,
          },
          status: "policy_candidate",
          execution: "hypothetical",
          confirmedAt: new Date(snapshotUtc(s.exported_at_utc)).toISOString(),
          confirmationOpenedServer: c.opened_at_server_raw,
          breakoutOpenedServer: bars[index].opened_at_server_raw,
          version: ENGINE_VERSION,
          tickVolumeRatio: null,
          base: {
            version: BASE_RETEST_VERSION,
            start: bars[base.start].opened_at_server_raw,
            end: bars[base.end].opened_at_server_raw,
            departure: bars[base.departure].opened_at_server_raw,
            level: trigger.level,
            anchor: trigger.pivot.openedAtServer,
          },
        });
      }
    }
  }
  const seen = new Set<string>();
  return plans.filter((p) => {
    const k = p.timeframe + ":" + p.direction;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
