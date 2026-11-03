/** Independent M5 tick-volume momentum technique. Candidate calculation; publication requires an enabled server policy. */
import { createHash } from "node:crypto";
import { confirmedPivots } from "./structure";
import { inspectMt5Snapshot, mt5SnapshotSchema } from "./mt5";
import type { z } from "zod";
type Bar = z.infer<
  typeof mt5SnapshotSchema
>["series"][number]["candles"][number];
export const TICK_VOLUME_RULES = Object.freeze({
  version: "tick-volume-momentum-v1",
  lookback: 20,
  minimumVolumeRatio: 1.5,
  minimumBodyFraction: 0.6,
  maximumClosingWickFraction: 0.2,
});
export function tickVolumeMomentum(bars: Bar[], serverTime: number) {
  const rules = TICK_VOLUME_RULES;
  const wait = (reason: string) => ({ direction: "WAIT" as const, reason });
  if (!Number.isFinite(serverTime)) return wait("invalid_server_time");
  const window = bars.slice(-(rules.lookback + 1));
  if (window.length < rules.lookback + 1)
    return wait("insufficient_m5_history");
  if (
    window.some(
      (bar, i) =>
        !Number.isFinite(bar.tick_volume) ||
        bar.tick_volume <= 0 ||
        (i > 0 &&
          bar.opened_at_server_raw - window[i - 1].opened_at_server_raw !==
            300),
    )
  )
    return wait("missing_volume_or_noncontiguous_history");
  const candle = window.at(-1)!;
  const closedAt = candle.opened_at_server_raw + 300;
  if (closedAt > serverTime || serverTime - closedAt >= 300)
    return wait("latest_completed_m5_required");
  // The signal candle is excluded from its own baseline; no future bars are used.
  const mean =
    window.slice(0, -1).reduce((sum, bar) => sum + bar.tick_volume, 0) /
    rules.lookback;
  const volumeRatio = candle.tick_volume / mean;
  if (volumeRatio < rules.minimumVolumeRatio)
    return wait("volume_below_threshold");
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (!(range > 0) || body / range < rules.minimumBodyFraction)
    return wait("indecisive_candle");
  const buy = candle.close > candle.open;
  const closingWick = buy
    ? candle.high - candle.close
    : candle.close - candle.low;
  if (closingWick / range > rules.maximumClosingWickFraction)
    return wait("close_away_from_momentum_extreme");
  return {
    direction: buy ? ("BUY" as const) : ("SELL" as const),
    reason: "volume_and_m5_momentum_confirmed",
    closedAt,
    referenceClose: candle.close,
    volumeRatio,
    baselineVolume: mean,
    tickVolume: candle.tick_volume,
  };
}
export function scanTickVolume(raw: unknown, now: number) {
  const snapshot = mt5SnapshotSchema.parse(raw);
  if (!inspectMt5Snapshot(snapshot, now).freshness.usableCurrentQuote)
    throw new Error("Fresh broker feed required");
  const decision = tickVolumeMomentum(
    snapshot.series.find((series) => series.timeframe === "M5")!.candles,
    snapshot.server_time_raw,
  );
  const entry =
    decision.direction === "BUY" ? snapshot.quote.ask : snapshot.quote.bid;
  const risk =
    decision.direction === "WAIT"
      ? null
      : tickVolumeRisk(
          decision.direction,
          entry,
          tickVolumeLevels(snapshot.series, decision.closedAt),
          snapshot.point,
        );
  return {
    version: TICK_VOLUME_RULES.version,
    mode: "policy_controlled" as const,
    timeframe: "M5" as const,
    symbol: snapshot.symbol,
    ...decision,
    candidateId:
      decision.direction === "WAIT"
        ? null
        : createHash("sha256")
            .update(
              `${TICK_VOLUME_RULES.version}:${snapshot.symbol}:M5:${decision.closedAt}:${decision.direction}`,
            )
            .digest("hex"),
    status:
      decision.direction === "WAIT"
        ? "wait"
        : risk
          ? "risk_ready"
          : "withheld_missing_roadblocks",
    entry: decision.direction === "WAIT" || !risk ? null : entry,
    risk,
    publicationRequiresPolicy: true,
  };
}

export type TickRoadblock = {
  timeframe: "M5" | "M15" | "M30" | "H1" | "H4";
  kind: "support" | "resistance";
  price: number;
};
/** Only intact, confirmed swings qualify; consumed levels cannot become targets. */
export function tickVolumeLevels(
  series: z.infer<typeof mt5SnapshotSchema>["series"],
  asOf: number,
): TickRoadblock[] {
  const levels: TickRoadblock[] = [];
  for (const timeframe of ["M5", "M15", "M30", "H1", "H4"] as const) {
    const duration = { M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400 }[
      timeframe
    ];
    const bars =
      series
        .find((s) => s.timeframe === timeframe)
        ?.candles.filter((b) => b.opened_at_server_raw + duration <= asOf) ??
      [];
    for (const pivot of confirmedPivots(bars, 2)) {
      const crossed = bars
        .slice(pivot.confirmedIndex + 1)
        .some((b) =>
          pivot.kind === "high" ? b.high >= pivot.price : b.low <= pivot.price,
        );
      if (!crossed)
        levels.push({
          timeframe,
          kind: pivot.kind === "high" ? "resistance" : "support",
          price: pivot.price,
        });
    }
  }
  return levels;
}
export function tickVolumeRisk(
  direction: "BUY" | "SELL",
  entry: number,
  levels: TickRoadblock[],
  point: number,
) {
  const buy = direction === "BUY";
  const stops = levels
    .filter(
      (l) =>
        ["M5", "M15", "M30"].includes(l.timeframe) &&
        l.kind === (buy ? "support" : "resistance") &&
        (buy ? l.price < entry : l.price > entry),
    )
    .sort((a, b) => (buy ? b.price - a.price : a.price - b.price));
  const targets = levels
    .filter(
      (l) =>
        ["M30", "H1", "H4"].includes(l.timeframe) &&
        l.kind === (buy ? "resistance" : "support") &&
        (buy ? l.price > entry : l.price < entry),
    )
    .sort((a, b) => (buy ? a.price - b.price : b.price - a.price))
    .filter(
      (l, i, a) => i === 0 || Math.abs(l.price - a[i - 1].price) >= point,
    );
  if (!stops.length || targets.length < 3) return null;
  return {
    stop: stops[0].price,
    stopLevel: stops[0],
    targets: targets.slice(0, 3).map((l) => l.price),
    targetLevels: targets.slice(0, 3),
  };
}
