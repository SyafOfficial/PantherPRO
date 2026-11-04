import { mt5SnapshotSchema, inspectMt5Snapshot } from "./mt5";
import { targetEvidence } from "./automatic";
import { detectStructure } from "./structure";
import { previewTrendline, type TrendlineProposal } from "./trendline-preview";
const frames = ["M15", "M30", "H1", "H4", "W1"] as const;
const seconds: Record<string, number> = {
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  W1: 604800,
};
function end(open: number, frame: string) {
  if (frame === "MN1") {
    const d = new Date(open * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return open + seconds[frame];
}
/** Offline comparison only: no database, notification or publication calls. */
export function scanTrendlinePreview(raw: unknown, now: number) {
  const snapshot = mt5SnapshotSchema.parse(raw);
  const inspection = inspectMt5Snapshot(snapshot, now);
  if (!inspection.freshness.usableCurrentQuote)
    throw new Error("Fresh snapshot required");
  const m5Bars = snapshot.series
    .find((s) => s.timeframe === "M5")!
    .candles.filter(
      (b) => end(b.opened_at_server_raw, "M5") <= snapshot.server_time_raw,
    );
  const confirm = m5Bars.at(-1);
  if (!confirm) return { proposals: [], reason: "No completed M5 candle" };
  const asOf = snapshot.server_time_raw;
  const proposals: (TrendlineProposal & {
    timeframe: string;
    higherTimeframe: string;
  })[] = [];
  for (const [i, frame] of frames.entries()) {
    const higher = frames[i + 1] ?? "MN1";
    const bars = snapshot.series
      .find((s) => s.timeframe === frame)!
      .candles.filter(
        (b) =>
          end(b.opened_at_server_raw, frame) <= confirm.opened_at_server_raw,
      );
    const higherBars = snapshot.series
      .find((s) => s.timeframe === higher)!
      .candles.filter(
        (b) =>
          end(b.opened_at_server_raw, higher) <=
          confirm.opened_at_server_raw + 300,
      );
    const higherTrend = detectStructure(higherBars).trend;
    const buyTargets = targetEvidence(
      snapshot,
      frame,
      true,
      confirm.low,
      confirm.high,
      confirm.opened_at_server_raw + 300,
    );
    const sellTargets = targetEvidence(
      snapshot,
      frame,
      false,
      confirm.low,
      confirm.high,
      confirm.opened_at_server_raw + 300,
    );
    for (
      let index = Math.max(19, bars.length - 3);
      index < bars.length;
      index++
    ) {
      const result = previewTrendline({
        setupBars: bars.slice(0, index + 1),
        setupEnd: end(bars[index].opened_at_server_raw, frame),
        subsequentSetupBars: bars.slice(index + 1),
        m5Bars,
        asOf,
        higherTrend:
          higherTrend === "up" ||
          higherTrend === "down" ||
          higherTrend === "range"
            ? higherTrend
            : "unknown",
        bid: snapshot.quote.bid,
        ask: snapshot.quote.ask,
        point: snapshot.point,
        target: {
          buy: buyTargets?.obstacles[0].price ?? null,
          sell: sellTargets?.obstacles[0].price ?? null,
        },
      });
      for (const proposal of result) {
        // Preserve the existing requirement for real ask-side M5 stop evidence on SELL.
        if (
          proposal.direction === "SELL" &&
          !(snapshot.ask_m5 ?? []).some(
            (b) => b.opened_at_server_raw === confirm.opened_at_server_raw,
          )
        )
          continue;
        proposals.push({
          ...proposal,
          timeframe: frame,
          higherTimeframe: higher,
        });
      }
    }
  }
  return {
    proposals,
    reason: "Research preview; no publication or performance claim",
  };
}
