import { z } from "zod";
import { TIMEFRAMES } from "../strategy";
import { mt5SnapshotSchema, inspectMt5Snapshot } from "./mt5";
type Snapshot = z.infer<typeof mt5SnapshotSchema>;
type Bar = Snapshot["series"][number]["candles"][number];
export type Pivot = {
  kind: "high" | "low";
  price: number;
  barIndex: number;
  confirmedIndex: number;
  openedAtServer: number;
};
// Initial detector convention, for shadow analysis only: strict two-sided swing pivots.
export function confirmedPivots(bars: Bar[], strength = 2): Pivot[] {
  if (!Number.isInteger(strength) || strength < 1 || strength > 10)
    throw new Error("Invalid pivot strength");
  const pivots: Pivot[] = [];
  for (let i = strength; i < bars.length - strength; i++) {
    const neighbours = bars
      .slice(i - strength, i + strength + 1)
      .filter((_, j) => j !== strength);
    for (const kind of ["high", "low"] as const)
      if (
        neighbours.every((b) =>
          kind === "high" ? bars[i].high > b.high : bars[i].low < b.low,
        )
      )
        pivots.push({
          kind,
          price: bars[i][kind],
          barIndex: i,
          confirmedIndex: i + strength,
          openedAtServer: bars[i].opened_at_server_raw,
        });
  }
  return pivots;
}
function trend(pivots: Pivot[]) {
  const highs = pivots.filter((p) => p.kind === "high").slice(-2),
    lows = pivots.filter((p) => p.kind === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "unknown";
  if (highs[1].price > highs[0].price && lows[1].price > lows[0].price)
    return "up";
  if (highs[1].price < highs[0].price && lows[1].price < lows[0].price)
    return "down";
  return "range";
}
export function detectStructure(bars: Bar[], strength = 2) {
  if (bars.length < 2 * strength + 6)
    return {
      status: "insufficient_history" as const,
      trend: "unknown" as const,
      breaks: [],
    };
  const current = bars.at(-1)!,
    previous = bars.at(-2)!;
  // Latest candle is excluded from pivot confirmation: no look-ahead through the breakout.
  const pivots = confirmedPivots(bars.slice(0, -1), strength),
    directionalTrend = trend(pivots);
  const breaks: Array<{
    direction: "BUY" | "SELL";
    method: "BOS" | "CHOCH";
    level: number;
    pivot: Pivot;
    breakoutOpenedAtServer: number;
  }> = [];
  if (directionalTrend === "up" || directionalTrend === "down")
    for (const kind of ["high", "low"] as const) {
      const pivot = pivots.filter((p) => p.kind === kind).at(-1);
      if (!pivot) continue;
      const buy = kind === "high";
      if (
        buy
          ? previous.close <= pivot.price && current.close > pivot.price
          : previous.close >= pivot.price && current.close < pivot.price
      ) {
        // Only the first close crossing a level counts; a later recross is not a new structure break.
        if (
          bars
            .slice(pivot.confirmedIndex + 1, -1)
            .some((b) => (buy ? b.close > pivot.price : b.close < pivot.price))
        )
          continue;
        breaks.push({
          direction: buy ? "BUY" : "SELL",
          method: (
            buy ? directionalTrend === "up" : directionalTrend === "down"
          )
            ? "BOS"
            : "CHOCH",
          level: pivot.price,
          pivot,
          breakoutOpenedAtServer: current.opened_at_server_raw,
        });
      }
    }
  return { status: "analysed" as const, trend: directionalTrend, breaks };
}
export function scanMt5Structure(raw: unknown, now: number, strength = 2) {
  const snapshot = mt5SnapshotSchema.parse(raw),
    inspection = inspectMt5Snapshot(snapshot, now);
  if (!inspection.freshness.usableCurrentQuote)
    throw new Error("Current MT5 snapshot is stale; scanning withheld");
  const byFrame = TIMEFRAMES.map((timeframe) => {
    const series = snapshot.series.find((s) => s.timeframe === timeframe)!;
    if (series.availability !== "available")
      return {
        timeframe,
        status: "unavailable" as const,
        trend: "unknown" as const,
        breaks: [],
      };
    return { timeframe, ...detectStructure(series.candles, strength) };
  });
  return {
    mode: "shadow_only" as const,
    pivotStrength: strength,
    source: snapshot.provider,
    symbol: snapshot.symbol,
    timeBasis: "broker_server" as const,
    frames: byFrame,
    methods: {
      BOS: "prototype",
      CHOCH: "prototype",
      QM: "not_implemented",
      TRENDLINE: "not_implemented",
    },
    entrySignalReady: false,
    signalPublished: false,
    pending: [
      "Confirm pivot convention",
      "Detect and validate entry zones and pullbacks",
      "Align higher-timeframe context",
      "Select structural targets",
      "Confirm broker pip convention",
      "Normalize historical session times",
      "Persist and review candidates",
      "Connect monitoring events transactionally to notification outbox",
    ],
  };
}
