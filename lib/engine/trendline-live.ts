import { scanBaseRetests } from "./base-retest";
import { scanCh } from "./ch";
import { scanHns } from "./hns";
import { createHash } from "node:crypto";
import {
  scanAutomatic,
  targetEvidence,
  ENGINE_VERSION,
  type AutomaticPlan,
} from "./automatic";
import { scanTrendlinePreview } from "./trendline-preview-snapshot";
import { mt5SnapshotSchema, snapshotUtc } from "./mt5";
import { VESTRADO_RULES } from "./config";
import type { TrendlineProposal } from "./trendline-preview";
import type { TIMEFRAMES } from "../strategy";
type Frame = (typeof TIMEFRAMES)[number];
export type LiveTrendlinePlan = AutomaticPlan & {
  trendline: Pick<
    TrendlineProposal,
    "version" | "subtype" | "anchors" | "eventOpened" | "confirmationOpened"
  > & { precision: "point" };
};
export function makeTrendlinePlan(
  proposal: TrendlineProposal & { timeframe: string; higherTimeframe: string },
  snapshot: ReturnType<typeof mt5SnapshotSchema.parse>,
): LiveTrendlinePlan | null {
  const buy = proposal.direction === "BUY";
  const targets = targetEvidence(
    snapshot,
    proposal.timeframe as Frame,
    buy,
    proposal.zoneLow,
    proposal.zoneHigh,
    proposal.confirmationOpened + 300,
  );
  if (!targets || Math.abs(targets.obstacles[0].price - proposal.target) > 1e-8)
    return null;
  // One publication per anchored line, subtype and direction, rather than a new
  // signal at every subsequent candle that touches the same line.
  const id = createHash("sha256")
    .update(
      [
        proposal.version,
        snapshot.symbol,
        proposal.timeframe,
        proposal.subtype,
        proposal.direction,
        ...proposal.anchors,
      ].join(":"),
    )
    .digest("hex");
  return {
    id,
    sourceEventId: id,
    provider: snapshot.provider,
    method: "TRENDLINE",
    timeframe: proposal.timeframe as Frame,
    higherTimeframe: proposal.higherTimeframe as Frame,
    direction: proposal.direction,
    zoneLow: proposal.zoneLow,
    zoneHigh: proposal.zoneHigh,
    entry: proposal.entry,
    stop: proposal.stop,
    targets: [
      targets.obstacles[0].price,
      targets.obstacles[1].price,
      targets.maximumTarget,
    ],
    targetReasons: [
      ...targets.obstacles.map((o) => o.reason),
      targets.maximumTargetReason,
    ],
    reason: `Trendline ${proposal.subtype === "bounce" ? "Bounce" : "Breakout + Retest"}. ${proposal.timeframe} setup with ${proposal.higherTimeframe} alignment and completed M5 confirmation.`,
    config: {
      pipSize: VESTRADO_RULES.pipSize,
      maxZonePips: VESTRADO_RULES.maxZonePips,
      slBufferPips: proposal.stopBuffer / VESTRADO_RULES.pipSize,
      partialPips: 50,
    },
    status: "policy_candidate",
    execution: "hypothetical",
    confirmedAt: new Date(snapshotUtc(snapshot.exported_at_utc)).toISOString(),
    confirmationOpenedServer: proposal.confirmationOpened,
    breakoutOpenedServer: proposal.eventOpened,
    version: ENGINE_VERSION,
    tickVolumeRatio: null,
    trendline: {
      version: proposal.version,
      precision: "point",
      subtype: proposal.subtype,
      anchors: proposal.anchors,
      eventOpened: proposal.eventOpened,
      confirmationOpened: proposal.confirmationOpened,
    },
  };
}
export function scanLiveAutomatic(raw: unknown, now: number) {
  const result = scanAutomatic(raw, now);
  const snapshot = mt5SnapshotSchema.parse(raw);
  const structural: AutomaticPlan[] = [];
  const hnsKeys = new Set<string>();
  for (const p of [
    ...scanHns(snapshot, now),
    ...scanCh(snapshot, now),
    ...scanBaseRetests(snapshot, now),
    ...result.plans.filter(
      (p) => !["TRENDLINE", "BOS", "CHOCH"].includes(p.method),
    ),
  ]) {
    const key = `${p.timeframe}:${p.direction}:${p.confirmationOpenedServer}`;
    if (!hnsKeys.has(key)) {
      structural.push(p);
      hnsKeys.add(key);
    }
  }
  const proposals = scanTrendlinePreview(snapshot, now).proposals;
  const seen = new Set(
    structural.map(
      (p) => `${p.timeframe}:${p.direction}:${p.confirmationOpenedServer}`,
    ),
  );
  const plans: AutomaticPlan[] = [...structural];
  for (const proposal of proposals) {
    const key = `${proposal.timeframe}:${proposal.direction}:${proposal.confirmationOpened}`;
    if (seen.has(key)) continue;
    const plan = makeTrendlinePlan(proposal, snapshot);
    if (plan) {
      plans.push(plan);
      seen.add(key);
    }
  }
  return { ...result, plans };
}
