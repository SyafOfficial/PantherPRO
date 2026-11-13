import { createHash } from "node:crypto";
import { TIMEFRAMES } from "../strategy";
import {
  ENGINE_VERSION,
  targetEvidence,
  type AutomaticPlan,
} from "./automatic";
import { baseBarEnd, type BaseBar } from "./base-retest";
import { VESTRADO_RULES } from "./config";
import { levelRetestRejection } from "./hns";
import { inspectMt5Snapshot, snapshotUtc, type mt5SnapshotSchema } from "./mt5";
import { detectStructure } from "./structure";
import type { z } from "zod";

type Snapshot = z.infer<typeof mt5SnapshotSchema>;
export const ROLE_REVERSAL_VERSION = "sbr-rbs-v1";
export type RoleReversalPlan = AutomaticPlan & {
  roleReversal: {
    version: typeof ROLE_REVERSAL_VERSION;
    level: number;
    anchor: number;
    reference: BaseBar;
    breakout: number;
    retest: number;
  };
};

/** Prefix ends AT the breakout. Later candles can never become the SL reference. */
export function lastLevelTouch(
  prefix: BaseBar[],
  anchor: number,
  level: number,
) {
  const start = prefix.findIndex((b) => b.opened_at_server_raw === anchor);
  if (start < 0) return null;
  for (let i = prefix.length - 2; i >= start; i--)
    if (prefix[i].low <= level && prefix[i].high >= level) {
      const { opened_at_server_raw, open, high, low, close } = prefix[i];
      return { opened_at_server_raw, open, high, low, close };
    }
  return null;
}

/** First representable broker price STRICTLY outside the selected wick. */
export function outsideWick(wick: number, buy: boolean, digits: number) {
  const scale = 10 ** digits;
  // Stabilise integer tick boundaries against binary floating point noise.
  const scaled = Number((wick * scale).toFixed(5));
  return (buy ? Math.ceil(scaled) - 1 : Math.floor(scaled) + 1) / scale;
}

/** Same rejection thresholds and reclaim checks as HNS/CH, at a horizontal level. */
export function roleReversalRejection(
  level: number,
  buy: boolean,
  m5: BaseBar[],
  breakEnd: number,
  server: number,
  point: number,
) {
  return levelRetestRejection(() => level, buy, m5, breakEnd, server, point);
}

export function scanRoleReversals(s: Snapshot, now: number) {
  const plans: RoleReversalPlan[] = [],
    reasons: string[] = [];
  if (!inspectMt5Snapshot(s, now).freshness.usableCurrentQuote)
    return { plans, reasons: ["SBR/RBS: stale broker quote"] };
  const m5 = s.series
    .find((v) => v.timeframe === "M5")!
    .candles.filter((b) => baseBarEnd(b, "M5") <= s.server_time_raw);
  const c = m5.at(-1);
  if (!c || s.server_time_raw - baseBarEnd(c, "M5") > 300)
    return { plans, reasons: ["SBR/RBS: no fresh completed M5 confirmation"] };
  for (const [fi, frame] of TIMEFRAMES.entries()) {
    const bars = s.series
      .find((v) => v.timeframe === frame)!
      .candles.filter((b) => baseBarEnd(b, frame) <= c.opened_at_server_raw);
    const higher = TIMEFRAMES[fi + 1] ?? null;
    const trend = higher
      ? detectStructure(
          s.series
            .find((v) => v.timeframe === higher)!
            .candles.filter(
              (b) => baseBarEnd(b, higher) <= baseBarEnd(c, "M5"),
            ),
        ).trend
      : null;
    for (let i = bars.length - 1; i >= Math.max(14, bars.length - 12); i--) {
      const prefix = bars.slice(0, i + 1);
      for (const trigger of detectStructure(prefix).breaks) {
        const buy = trigger.direction === "BUY",
          method = buy ? "RBS" : "SBR";
        const reject = (why: string) =>
          reasons.push(
            `${method} ${frame} ${bars[i].opened_at_server_raw}: ${why}`,
          );
        const reference = lastLevelTouch(
          prefix,
          trigger.pivot.openedAtServer,
          trigger.level,
        );
        if (!reference) {
          reject("missing pre-breakout last-touch SL reference");
          continue;
        }
        if (higher && trend !== (buy ? "up" : "down")) {
          reject("higher timeframe does not align");
          continue;
        }
        if (
          bars
            .slice(i + 1)
            .some((b) =>
              buy ? b.close < trigger.level : b.close > trigger.level,
            ) ||
          !roleReversalRejection(
            trigger.level,
            buy,
            m5,
            baseBarEnd(bars[i], frame),
            s.server_time_raw,
            s.point,
          )
        ) {
          reject("retest/rejection absent or level reclaimed");
          continue;
        }
        // Same full completed M5 rejection zone used by the existing level-retest patterns.
        const zoneLow = c.low,
          zoneHigh = c.high,
          entry = buy ? s.quote.ask : s.quote.bid;
        const stop = outsideWick(
          buy ? reference.low : reference.high,
          buy,
          s.digits,
        );
        if (stop <= 0 || (buy ? stop >= zoneLow : stop <= zoneHigh)) {
          reject("SL is not outside the entire entry zone");
          continue;
        }
        if (
          zoneHigh - zoneLow >
            VESTRADO_RULES.maxZonePips * VESTRADO_RULES.pipSize ||
          entry < zoneLow ||
          entry > zoneHigh
        ) {
          reject("entry outside zone or zone exceeds 80 pips");
          continue;
        }
        if (
          !buy &&
          !(s.ask_m5 ?? []).some(
            (b) => b.opened_at_server_raw === c.opened_at_server_raw,
          )
        ) {
          reject("actual ask M5 unavailable");
          continue;
        }
        const targets = targetEvidence(
          s,
          frame,
          buy,
          zoneLow,
          zoneHigh,
          baseBarEnd(c, "M5"),
        );
        if (!targets) {
          reject("three intact structural targets unavailable");
          continue;
        }
        const id = createHash("sha256")
          .update(
            [
              ROLE_REVERSAL_VERSION,
              s.symbol,
              frame,
              trigger.direction,
              trigger.pivot.openedAtServer,
              bars[i].opened_at_server_raw,
            ].join(":"),
          )
          .digest("hex");
        plans.push({
          id,
          sourceEventId: id,
          provider: s.provider,
          method,
          timeframe: frame,
          higherTimeframe: higher,
          direction: trigger.direction,
          zoneLow,
          zoneHigh,
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
          reason: `${method} ${frame} ${trigger.direction}: old level ${trigger.level}, confirmed close breakout ${bars[i].opened_at_server_raw}, completed M5 retest/rejection ${c.opened_at_server_raw}. SL ${stop} strictly outside last pre-breakout touch candle ${reference.opened_at_server_raw}; no fixed pip buffer. BE at 50 pips; TP1–TP3 follow intact M30/H1/H4 structure.`,
          config: {
            pipSize: VESTRADO_RULES.pipSize,
            maxZonePips: VESTRADO_RULES.maxZonePips,
            slBufferPips: 0,
            partialPips: 50,
          },
          status: "policy_candidate",
          execution: "hypothetical",
          confirmedAt: new Date(snapshotUtc(s.exported_at_utc)).toISOString(),
          confirmationOpenedServer: c.opened_at_server_raw,
          breakoutOpenedServer: bars[i].opened_at_server_raw,
          version: ENGINE_VERSION,
          tickVolumeRatio: null,
          roleReversal: {
            version: ROLE_REVERSAL_VERSION,
            level: trigger.level,
            anchor: trigger.pivot.openedAtServer,
            reference,
            breakout: bars[i].opened_at_server_raw,
            retest: c.opened_at_server_raw,
          },
        });
      }
    }
  }
  const seen = new Set<string>();
  return {
    plans: plans.filter((p) => {
      const key = `${p.timeframe}:${p.direction}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    reasons,
  };
}
