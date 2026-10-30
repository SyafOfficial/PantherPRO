import { createHash } from "node:crypto";
import { z } from "zod";
import { TIMEFRAMES } from "../strategy";
import { mt5SnapshotSchema, inspectMt5Snapshot, snapshotUtc } from "./mt5";
import { confirmedPivots, detectStructure } from "./structure";
import { buildCandidate, type Candidate, type SetupInput } from "./rules";
import { VESTRADO_RULES } from "./config";
type Snapshot = z.infer<typeof mt5SnapshotSchema>;
type Bar = Snapshot["series"][number]["candles"][number];
type Frame = (typeof TIMEFRAMES)[number];
export const ENGINE_VERSION = "vestrado-structure-v1";
export type AutomaticPlan = Omit<Candidate, "status"> & {
  status: "policy_candidate";
  entry: number;
  sourceEventId: string;
  confirmationOpenedServer: number;
  breakoutOpenedServer: number;
  version: typeof ENGINE_VERSION;
  higherTimeframe: Frame | null;
  tickVolumeRatio: number | null;
};
const seconds: Record<string, number> = {
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  W1: 604800,
};
function endOf(bar: Bar, frame: string) {
  if (frame === "MN1") {
    const d = new Date(bar.opened_at_server_raw * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return bar.opened_at_server_raw + seconds[frame];
}
const iso = (t: number) => new Date(t * 1000).toISOString();
const virtualCandle = (b: Bar, frame: string) => ({
  openedAt: iso(b.opened_at_server_raw),
  closedAt: iso(endOf(b, frame)),
  open: b.open,
  high: b.high,
  low: b.low,
  close: b.close,
});
// Clock arithmetic below stays in broker wall-time coordinates. Only actual snapshot
// receipt/export UTC is used as the external candidate confirmation timestamp.
export function methodTriggers(
  prefix: Bar[],
  confirmationOpened = prefix.at(-1)?.opened_at_server_raw ?? 0,
) {
  if (prefix.length < 3) return [];
  const breakBar = prefix.at(-1)!;
  const pivots = confirmedPivots(prefix.slice(0, -1), 2);
  const triggers: Array<{
    method: AutomaticPlan["method"];
    buy: boolean;
    level: number;
    anchor: number;
  }> = detectStructure(prefix).breaks.map((b) => ({
    method: b.method,
    buy: b.direction === "BUY",
    level: b.level,
    anchor: b.pivot.openedAtServer,
  }));
  // QM: left shoulder, neckline, higher head (SELL), or mirrored lower head (BUY),
  // followed by a first close across the neckline and a shoulder retest.
  const alternating = pivots
    .filter((p, i, a) => i === 0 || p.kind !== a[i - 1].kind)
    .slice(-3);
  if (
    alternating.length === 3 &&
    alternating[0].barIndex < alternating[1].barIndex &&
    alternating[1].barIndex < alternating[2].barIndex
  ) {
    const [left, neck, head] = alternating;
    for (const buy of [true, false])
      if (
        left.kind === (buy ? "low" : "high") &&
        neck.kind === (buy ? "high" : "low") &&
        head.kind === left.kind &&
        (buy ? head.price < left.price : head.price > left.price)
      ) {
        if (
          (buy
            ? prefix[prefix.length - 2].close <= neck.price &&
              breakBar.close > neck.price
            : prefix[prefix.length - 2].close >= neck.price &&
              breakBar.close < neck.price) &&
          !prefix
            .slice(head.confirmedIndex + 1, -1)
            .some((b) => (buy ? b.close > neck.price : b.close < neck.price))
        )
          triggers.push({
            method: "QM",
            buy,
            level: left.price,
            anchor: left.openedAtServer,
          });
      }
  }
  // Trendline: two confirmed directional anchors, then a completed third-touch rejection.
  for (const buy of [true, false]) {
    const anchors = pivots
      .filter((p) => p.kind === (buy ? "low" : "high"))
      .slice(-2);
    if (anchors.length === 2) {
      const [a, b] = anchors,
        dt = b.openedAtServer - a.openedAtServer;
      if (dt > 0 && (buy ? b.price > a.price : b.price < a.price)) {
        const level =
          b.price +
          ((b.price - a.price) *
            (breakBar.opened_at_server_raw - b.openedAtServer)) /
            dt;
        const tolerance = VESTRADO_RULES.pipSize * 2;
        if (
          level > 0 &&
          breakBar.low <= level + tolerance &&
          breakBar.high >= level - tolerance &&
          (buy
            ? breakBar.close > level && breakBar.close > breakBar.open
            : breakBar.close < level && breakBar.close < breakBar.open)
        )
          triggers.push({
            method: "TRENDLINE",
            buy,
            level:
              b.price +
              ((b.price - a.price) * (confirmationOpened - b.openedAtServer)) /
                dt,
            anchor: a.openedAtServer,
          });
      }
    }
  }
  triggers.sort(
    (a, b) =>
      ["QM", "CHOCH", "BOS", "TRENDLINE"].indexOf(a.method) -
      ["QM", "CHOCH", "BOS", "TRENDLINE"].indexOf(b.method),
  );
  return triggers;
}

export function targetEvidence(
  snapshot: Snapshot,
  frame: Frame,
  buy: boolean,
  zoneLow: number,
  zoneHigh: number,
  asOf: number,
) {
  const endpoint = buy ? zoneHigh : zoneLow,
    sign = buy ? 1 : -1;
  const of = (f: string) =>
    snapshot.series
      .find((s) => s.timeframe === f)!
      .candles.filter((b) => endOf(b, f) <= asOf);
  const setup = of(frame),
    pivots = confirmedPivots(setup, 2)
      .filter(
        (p) =>
          p.kind === (buy ? "high" : "low") && sign * (p.price - endpoint) > 0,
      )
      .sort((a, b) => sign * (a.price - b.price));
  const maximum = pivots[0];
  if (!maximum) return null;
  const obstacles: SetupInput["obstacles"] = [];
  for (const f of ["M5", "M15", "M30"] as const) {
    const candles = of(f);
    for (const p of confirmedPivots(candles, 2)) {
      if (
        p.kind !== (buy ? "high" : "low") ||
        sign * (p.price - endpoint) <= 0 ||
        sign * (maximum.price - p.price) <= 0
      )
        continue;
      obstacles.push({
        price: p.price,
        timeframe: f,
        confirmedAt: iso(endOf(candles[p.confirmedIndex], f)),
        reason: `Confirmed ${f} ${buy ? "resistance" : "support"} pivot at ${p.price}.`,
      });
    }
  }
  const distinct = [...new Set(obstacles.map((o) => o.price))];
  if (distinct.length < 2) return null;
  return {
    maximumTarget: maximum.price,
    maximumTargetReason: `Nearest confirmed ${frame} ${buy ? "resistance" : "support"} bounds TP3.`,
    maximumTargetConfirmedAt: iso(endOf(setup[maximum.confirmedIndex], frame)),
    obstacles,
  };
}
export function scanAutomatic(raw: unknown, now: number) {
  const s = mt5SnapshotSchema.parse(raw),
    inspection = inspectMt5Snapshot(s, now);
  if (!inspection.freshness.usableCurrentQuote)
    throw new Error("Fresh broker feed required");
  const m5 = s.series.find((v) => v.timeframe === "M5")!.candles,
    confirm = m5.at(-1);
  if (!confirm || s.server_time_raw - endOf(confirm, "M5") > 300)
    return {
      plans: [] as AutomaticPlan[],
      reasons: ["No fresh completed M5 confirmation"],
    };
  const asOf = endOf(confirm, "M5"),
    plans: AutomaticPlan[] = [],
    reasons: string[] = [];
  for (const [frameIndex, frame] of TIMEFRAMES.entries()) {
    const bars = s.series
      .find((v) => v.timeframe === frame)!
      .candles.filter((b) => endOf(b, frame) <= asOf);
    const higher = TIMEFRAMES[frameIndex + 1] ?? null;
    const higherTrend = higher
      ? detectStructure(
          s.series
            .find((v) => v.timeframe === higher)!
            .candles.filter((b) => endOf(b, higher) <= asOf),
        ).trend
      : null;
    if (bars.length < 15) {
      reasons.push(`${frame}: insufficient history`);
      continue;
    }
    // Revisit recent breaks while waiting for a later M5 pullback. No daily signal quota.
    for (
      let index = bars.length - 1;
      index >= Math.max(14, bars.length - 12);
      index--
    ) {
      const prefix = bars.slice(0, index + 1),
        breakBar = bars[index];
      if (endOf(breakBar, frame) > confirm.opened_at_server_raw) continue;
      const triggers = methodTriggers(prefix, confirm.opened_at_server_raw);
      for (const trigger of triggers) {
        const { buy, level } = trigger;
        if (higherTrend && higherTrend !== (buy ? "up" : "down")) continue;
        if (
          bars
            .slice(index + 1)
            .some((b) => (buy ? b.close < level : b.close > level))
        )
          continue;
        // A zone is the full completed M5 rejection candle, anchored by the setup level.
        if (!(
          confirm.low <= level &&
          confirm.high >= level &&
          (buy ? confirm.close > level : confirm.close < level)
        ))
          continue;
        const zoneLow = confirm.low,
          zoneHigh = confirm.high,
          entry = buy ? s.quote.ask : s.quote.bid;
        if (entry < zoneLow || entry > zoneHigh) continue; // Never chase a price outside the published zone.
        if (
          (zoneHigh - zoneLow) / VESTRADO_RULES.pipSize >
          VESTRADO_RULES.maxZonePips
        )
          continue;
        const targets = targetEvidence(s, frame, buy, zoneLow, zoneHigh, asOf);
        if (!targets) continue;
        // SELL M5 invalidation requires a real ask-side candle stream, not guessed spread.
        if (
          !buy &&
          !(s.ask_m5 ?? []).some(
            (b) => b.opened_at_server_raw === confirm.opened_at_server_raw,
          )
        )
          continue;
        const id = createHash("sha256")
          .update(
            [
              ENGINE_VERSION,
              s.symbol,
              frame,
              trigger.method,
              buy,
              trigger.anchor,
              breakBar.opened_at_server_raw,
            ].join(":"),
          )
          .digest("hex");
        const recent = prefix
            .slice(-21, -1)
            .map((b) => b.tick_volume)
            .filter((v) => v > 0)
            .sort((a, b) => a - b),
          median = recent.length ? recent[Math.floor(recent.length / 2)] : 0;
        const ratio = median > 0 ? breakBar.tick_volume / median : null;
        try {
          const candidate = buildCandidate(
            {
              id,
              provider: s.provider,
              timeframe: frame,
              method: trigger.method,
              direction: buy ? "BUY" : "SELL",
              zoneLow,
              zoneHigh,
              breakoutLevel: level,
              breakout: virtualCandle(breakBar, frame),
              retestM5: virtualCandle(confirm, "M5"),
              ...targets,
              reason: `Automatic ${trigger.method} ${frame} ${buy ? "BUY" : "SELL"}: completed setup candle and M5 pullback held ${level.toFixed(s.digits)}; entry remains inside ${zoneLow}-${zoneHigh}. ${higher ? `${higher} structure aligns.` : "Monthly is the highest configured setup."} Tick activity ratio ${ratio === null ? "unavailable" : ratio.toFixed(2)}; aggressive imbalance unavailable. News feed unavailable. SL requires M5 close ${buy ? "below" : "above"} ${((buy ? zoneLow : zoneHigh) + (buy ? -3 : 3)).toFixed(s.digits)}. Trade at your own risk with proper money management.`,
              config: {
                pipSize: 0.1,
                maxZonePips: 80,
                slBufferPips: 30,
                partialPips: 50,
              },
            },
            s.server_time_raw * 1000,
          );
          plans.push({
            ...candidate,
            status: "policy_candidate",
            entry,
            confirmedAt: new Date(snapshotUtc(s.exported_at_utc)).toISOString(),
            sourceEventId: id,
            confirmationOpenedServer: confirm.opened_at_server_raw,
            breakoutOpenedServer: breakBar.opened_at_server_raw,
            version: ENGINE_VERSION,
            higherTimeframe: higher,
            tickVolumeRatio: ratio,
          });
        } catch {
          /* Incomplete targets or retest never become an executable setup. */
        }
      }
    }
  }
  // One proposal per frame/direction/confirmation; strongest pattern takes precedence.
  plans.sort(
    (a, b) =>
      ["QM", "CHOCH", "BOS", "TRENDLINE"].indexOf(a.method) -
      ["QM", "CHOCH", "BOS", "TRENDLINE"].indexOf(b.method),
  );
  const seen = new Set<string>();
  const unique = plans.filter((p) => {
    const key = [p.timeframe, p.direction, p.confirmationOpenedServer].join(
      ":",
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { plans: unique, reasons };
}
