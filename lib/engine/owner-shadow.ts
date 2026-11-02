/** Owner rules v2. Shadow output only: never publishes signals or places orders. */
import { createHash } from "node:crypto";
import { mt5SnapshotSchema, inspectMt5Snapshot, snapshotUtc } from "./mt5";
import { confirmedPivots, detectStructure } from "./structure";
import type { z } from "zod";
export const OWNER_RULES = Object.freeze({
  version: "panther-owner-v2",
  pipSize: 0.1,
  minZonePips: 50,
  maxZonePips: 80,
  stopBufferPips: 20,
  tp1Pips: 50,
  pivotStrength: 2,
  rejectionWickBodyRatio: 2,
  sessionStartMY: 6,
  sessionEndMY: 3,
});
export const FRAMES = ["M15", "M30", "H1", "H4", "D1", "W1", "MN1"] as const;
type Frame = (typeof FRAMES)[number];
type Snapshot = z.infer<typeof mt5SnapshotSchema>;
type Bar = Snapshot["series"][number]["candles"][number];
type Direction = "BUY" | "SELL";
export type Zone = { low: number; high: number };
export type ShadowSetup = {
  id: string;
  confirmedAtServer?: number;
  mode: "shadow_only";
  timeframe: Frame;
  direction: Direction;
  method: "QM" | "BOS" | "CHOCH" | "TRENDLINE";
  location: "fresh_zone" | "retracement_50" | "trendline";
  zone: Zone;
  invalidation: number;
  breakStrength: "wick" | "close";
  status: "monitor_zone" | "entry_confirmed";
  entry: number | null;
  targets: [number, number, number] | null;
  pending: string[];
};
const round = (n: number) => Math.round(n * 100) / 100;
const signOf = (d: Direction) => (d === "BUY" ? 1 : -1);
export function ownerZone(low: number, high: number): Zone | null {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low)
    return null;
  const width = high - low;
  if (width < 5 - 1e-8 || width > 8 + 1e-8) return null;
  return { low: round(low), high: round(high) };
}
export function zoneUntouched(zone: Zone, bars: Bar[]) {
  return !bars.some((b) => b.low <= zone.high && b.high >= zone.low);
}
export function ownerConfirmation(
  previous: Bar | undefined,
  current: Bar,
  direction: Direction,
) {
  const buy = direction === "BUY",
    body = Math.abs(current.close - current.open);
  if (!(buy ? current.close > current.open : current.close < current.open))
    return null;
  const wick = buy
    ? Math.min(current.open, current.close) - current.low
    : current.high - Math.max(current.open, current.close);
  // Provisional numeric convention; diagrams alone do not specify wick/body ratios.
  if (body > 0 && wick >= OWNER_RULES.rejectionWickBodyRatio * body)
    return "rejection";
  if (
    previous &&
    (buy ? previous.close < previous.open : previous.close > previous.open) &&
    Math.min(current.open, current.close) <=
      Math.min(previous.open, previous.close) &&
    Math.max(current.open, current.close) >=
      Math.max(previous.open, previous.close)
  )
    return "engulfing";
  return null;
}
export function ownerTargets(
  entry: number,
  direction: Direction,
  roadblocks: number[],
): [number, number, number] | null {
  const sign = signOf(direction),
    tp1 = round(entry + sign * 5);
  const ahead = [...new Set(roadblocks.filter(Number.isFinite).map(round))]
    .filter((p) => sign * (p - tp1) > 1e-8)
    .sort((a, b) => sign * (a - b));
  return ahead.length >= 2 ? [tp1, ahead[0], ahead[1]] : null;
}
export function ownerSession(utc: number) {
  const hour = new Date(utc + 8 * 3600000).getUTCHours();
  return hour >= 6 || hour < 3;
}
function closeAt(b: Bar, f: Frame | "M5") {
  if (f === "MN1") {
    const d = new Date(b.opened_at_server_raw * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return (
    b.opened_at_server_raw +
    {
      M5: 300,
      M15: 900,
      M30: 1800,
      H1: 3600,
      H4: 14400,
      D1: 86400,
      W1: 604800,
    }[f]
  );
}
export function scanOwnerShadow(raw: unknown, now: number) {
  const s = mt5SnapshotSchema.parse(raw);
  if (!inspectMt5Snapshot(s, now).freshness.usableCurrentQuote)
    throw new Error("Fresh broker feed required");
  const result = {
    version: OWNER_RULES.version,
    mode: "shadow_only" as const,
    setups: [] as ShadowSetup[],
    reasons: [] as string[],
  };
  if (!ownerSession(snapshotUtc(s.exported_at_utc))) {
    result.reasons.push("Outside 06:00–03:00 Malaysia session");
    return result;
  }
  const m5 = s.series.find((x) => x.timeframe === "M5")!.candles;
  const confirmation = m5.at(-1);
  if (!confirmation || s.server_time_raw - closeAt(confirmation, "M5") > 300) {
    result.reasons.push("Fresh completed M5 required");
    return result;
  }
  const asOf = closeAt(confirmation, "M5");
  const of = (f: Frame | "M5") =>
    s.series
      .find((x) => x.timeframe === f)
      ?.candles.filter((b) => closeAt(b, f) <= asOf) ?? [];
  if (!of("D1").length) {
    result.reasons.push(
      "Daily history missing: update MT5 exporter; hierarchy scan withheld",
    );
    return result;
  }
  const direction = (f: Frame) => detectStructure(of(f)).trend;
  const confirmationKind = (d: Direction) =>
    ownerConfirmation(m5.at(-2), confirmation, d);
  const primary: ShadowSetup[] = [];
  // Highest established directional context wins; missing context blocks lower frames.
  for (const [fi, frame] of FRAMES.entries()) {
    const bars = of(frame);
    if (bars.length < 15) {
      result.reasons.push(`${frame}: insufficient history`);
      continue;
    }
    const higher = FRAMES.slice(fi + 1)
      .reverse()
      .map(direction)
      .find((t) => t === "up" || t === "down");
    if (fi < FRAMES.length - 1 && !higher) {
      result.reasons.push(`${frame}: higher directional context missing`);
      continue;
    }
    const setups: ShadowSetup[] = [];
    for (let i = Math.max(14, bars.length - 12); i < bars.length; i++) {
      const prefix = bars.slice(0, i + 1),
        b = bars[i];
      if (closeAt(b, frame) > confirmation.opened_at_server_raw) continue;
      const pivots = confirmedPivots(prefix.slice(0, -1), 2);
      type Trigger = {
        method: ShadowSetup["method"];
        d: Direction;
        level: number;
        anchor: Bar;
        strength: "wick" | "close";
        location: ShadowSetup["location"];
      };
      const triggers: Trigger[] = [];
      for (const br of detectStructure(prefix).breaks) {
        const buy = br.direction === "BUY";
        const origin = [...pivots]
          .reverse()
          .find((p) => p.kind === (buy ? "low" : "high"));
        if (!origin) continue;
        const anchor = prefix[origin.barIndex];
        triggers.push({
          method: br.method,
          d: br.direction,
          level: buy ? anchor.low : anchor.high,
          anchor,
          strength: "close",
          location: "fresh_zone",
        });
        const midpoint =
          ((buy ? anchor.low : anchor.high) + (buy ? b.high : b.low)) / 2;
        triggers.push({
          method: br.method,
          d: br.direction,
          level: midpoint,
          anchor,
          strength: "close",
          location: "retracement_50",
        });
      }
      const alternating = pivots
        .filter((p, j, a) => !j || p.kind !== a[j - 1].kind)
        .slice(-3);
      if (alternating.length === 3) {
        const [left, neck, head] = alternating;
        for (const d of ["BUY", "SELL"] as const) {
          const buy = d === "BUY";
          if (
            left.kind !== (buy ? "low" : "high") ||
            neck.kind == left.kind ||
            head.kind !== left.kind ||
            !(buy ? head.price < left.price : head.price > left.price)
          )
            continue;
          const prior = prefix.slice(head.confirmedIndex + 1, -1);
          if (
            prior.some((x) => (buy ? x.high > neck.price : x.low < neck.price))
          )
            continue;
          if (!(buy ? b.high > neck.price : b.low < neck.price)) continue;
          triggers.push({
            method: "QM",
            d,
            level: left.price,
            anchor: prefix[left.barIndex],
            strength: (buy ? b.close > neck.price : b.close < neck.price)
              ? "close"
              : "wick",
            location: "fresh_zone",
          });
        }
      }
      for (const d of ["BUY", "SELL"] as const) {
        const buy = d === "BUY",
          anchors = pivots
            .filter((p) => p.kind === (buy ? "low" : "high"))
            .slice(-2);
        if (anchors.length !== 2) continue;
        const [a, c] = anchors,
          dt = c.openedAtServer - a.openedAtServer;
        if (dt <= 0 || !(buy ? c.price > a.price : c.price < a.price)) continue;
        const line = (t: number) =>
          c.price + ((c.price - a.price) * (t - c.openedAtServer)) / dt;
        if (
          prefix
            .slice(c.confirmedIndex + 1, -1)
            .some((x) =>
              buy
                ? x.close < line(x.opened_at_server_raw)
                : x.close > line(x.opened_at_server_raw),
            )
        )
          continue;
        const level = line(b.opened_at_server_raw),
          prev = prefix.at(-2)!;
        if (
          b.low <= level + 0.2 &&
          b.high >= level - 0.2 &&
          (buy ? b.close > level : b.close < level)
        )
          triggers.push({
            method: "TRENDLINE",
            d,
            level: line(confirmation.opened_at_server_raw),
            anchor: prefix[c.barIndex],
            strength: "close",
            location: "trendline",
          });
        // A completed close through an opposing line creates a breakout/retest candidate.
        if (
          buy
            ? prev.close >= line(prev.opened_at_server_raw) && b.close < level
            : prev.close <= line(prev.opened_at_server_raw) && b.close > level
        )
          triggers.push({
            method: "TRENDLINE",
            d: buy ? "SELL" : "BUY",
            level,
            anchor: prefix[c.barIndex],
            strength: "close",
            location: "trendline",
          });
      }
      for (const t of triggers) {
        const buy = t.d === "BUY";
        if (higher && higher !== (buy ? "up" : "down")) continue;
        // Origin wick supplies the outer boundary; narrow zones are explicitly padded inward.
        // Wide original zones are rejected, never silently cropped.
        const natural = t.anchor.high - t.anchor.low;
        if (t.location === "fresh_zone" && natural > 8) continue;
        const width = t.location === "fresh_zone" ? Math.max(5, natural) : 5;
        const zone =
          t.location === "retracement_50"
            ? ownerZone(t.level - 2.5, t.level + 2.5)
            : buy
              ? ownerZone(t.level, t.level + width)
              : ownerZone(t.level - width, t.level);
        if (!zone) continue;
        const later = m5.filter(
          (x) => x.opened_at_server_raw >= closeAt(b, frame),
        );
        const firstTouch = later.findIndex((x) => !zoneUntouched(zone, [x]));
        const invalidation = round(buy ? zone.low - 2 : zone.high + 2);
        if (
          later.some((x) =>
            buy ? x.close < invalidation : x.close > invalidation,
          )
        )
          continue;
        const touched = firstTouch >= 0;
        // Only the first-touch candle can confirm this initial conservative prototype.
        if (
          touched &&
          later[firstTouch].opened_at_server_raw !==
            confirmation.opened_at_server_raw
        )
          continue;
        const entry = buy ? s.quote.ask : s.quote.bid;
        const confirmed =
          touched &&
          !!confirmationKind(t.d) &&
          entry >= zone.low &&
          entry <= zone.high &&
          t.strength === "close";
        const blocks = ["M5", frame].flatMap((f) =>
          confirmedPivots(of(f as Frame | "M5"), 2)
            .filter((p) => p.kind === (buy ? "high" : "low"))
            .map((p) => p.price),
        );
        const targets = confirmed ? ownerTargets(entry, t.d, blocks) : null;
        const id = createHash("sha256")
          .update(
            [
              OWNER_RULES.version,
              frame,
              t.method,
              t.d,
              t.location,
              t.anchor.opened_at_server_raw,
              b.opened_at_server_raw,
            ].join(":"),
          )
          .digest("hex");
        setups.push({
          id,
          mode: "shadow_only",
          timeframe: frame,
          direction: t.d,
          method: t.method,
          location: t.location,
          zone,
          invalidation,
          breakStrength: t.strength,
          status: confirmed && targets ? "entry_confirmed" : "monitor_zone",
          confirmedAtServer: confirmed && targets ? asOf : undefined,
          entry: confirmed && targets ? entry : null,
          targets,
          pending:
            confirmed && !targets
              ? ["Two structural roadblocks beyond TP1 required"]
              : [],
        });
      }
    }
    // M15 is fallback only when no primary timeframe has a qualifying candidate.
    if (frame === "M15") result.setups.push(...setups);
    else primary.push(...setups);
  }
  if (primary.length) result.setups = primary;
  result.setups = [...new Map(result.setups.map((x) => [x.id, x])).values()];
  return result;
}

export type ShadowProgress = {
  targets: number[];
  invalidated: boolean;
  lastQuote: number;
  lastClose: number;
};
export function monitorOwnerShadow(
  setup: ShadowSetup,
  state: ShadowProgress,
  observation: {
    at: number;
    bid: number;
    ask: number;
    m5?: { closedAt: number; close: number };
  },
) {
  if (
    setup.status !== "entry_confirmed" ||
    !setup.targets ||
    !Number.isFinite(observation.at) ||
    !Number.isFinite(observation.bid) ||
    !Number.isFinite(observation.ask) ||
    observation.bid <= 0 ||
    observation.ask < observation.bid
  )
    throw new Error("Invalid monitor input");
  const next = { ...state, targets: [...state.targets] },
    events: { id: string; kind: string }[] = [];
  if (state.invalidated) return { state: next, events };
  const emit = (kind: string) =>
    events.push({ id: `${setup.id}:${kind}`, kind });
  const buy = setup.direction === "BUY";
  if (
    observation.m5 &&
    observation.m5.closedAt >
      Math.max(state.lastClose, setup.confirmedAtServer ?? 0) &&
    observation.m5.closedAt <= observation.at
  ) {
    next.lastClose = observation.m5.closedAt;
    if (
      buy
        ? observation.m5.close < setup.invalidation
        : observation.m5.close > setup.invalidation
    ) {
      next.invalidated = true;
      emit("invalidation_m5");
    }
  }
  if (!next.invalidated && observation.at > state.lastQuote) {
    next.lastQuote = observation.at;
    const price = buy ? observation.bid : observation.ask;
    setup.targets.forEach((target, i) => {
      if (
        !next.targets.includes(i) &&
        signOf(setup.direction) * (price - target) >= 0
      ) {
        next.targets.push(i);
        emit(`tp${i + 1}`);
      }
    });
  }
  return { state: next, events };
}
