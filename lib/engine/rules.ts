import { createHash } from "node:crypto";
import { z } from "zod";
import { TIMEFRAMES } from "../strategy";

export const setupFrames = TIMEFRAMES;
const candleSchema = z
  .object({
    openedAt: z.iso.datetime({ offset: true }),
    closedAt: z.iso.datetime({ offset: true }),
    open: z.number().positive().finite(),
    high: z.number().positive().finite(),
    low: z.number().positive().finite(),
    close: z.number().positive().finite(),
  })
  .strict()
  .refine(
    (c) =>
      c.high >= Math.max(c.open, c.close, c.low) &&
      c.low <= Math.min(c.open, c.close) &&
      Date.parse(c.closedAt) > Date.parse(c.openedAt),
    "Invalid OHLC candle",
  );
export type Candle = z.infer<typeof candleSchema>;
const configSchema = z
  .object({
    // Required broker convention. No implicit pip/lot conversion.
    pipSize: z.number().positive().finite(),
    maxZonePips: z.number().positive().max(80).default(80),
    slBufferPips: z.number().positive().max(30),
    partialPips: z.literal(50).default(50),
  })
  .strict();
const obstacleSchema = z
  .object({
    price: z.number().positive().finite(),
    timeframe: z.enum(["M5", "M15", "M30"]),
    confirmedAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(10),
  })
  .strict();
export const setupInputSchema = z
  .object({
    id: z.string().min(1).max(150),
    provider: z.string().min(1),
    timeframe: z.enum(setupFrames),
    method: z.enum(["QM", "BOS", "CHOCH", "TRENDLINE"]),
    direction: z.enum(["BUY", "SELL"]),
    zoneLow: z.number().positive().finite(),
    zoneHigh: z.number().positive().finite(),
    breakoutLevel: z.number().positive().finite(),
    breakout: candleSchema,
    retestM5: candleSchema,
    maximumTarget: z.number().positive().finite(),
    maximumTargetReason: z.string().trim().min(10),
    maximumTargetConfirmedAt: z.iso.datetime({ offset: true }),
    obstacles: z.array(obstacleSchema).max(100),
    reason: z.string().trim().min(20).max(2000),
    config: configSchema,
  })
  .strict();
export type SetupInput = z.input<typeof setupInputSchema>;
export type Candidate = {
  id: string;
  direction: "BUY" | "SELL";
  zoneLow: number;
  zoneHigh: number;
  stop: number;
  targets: [number, number, number];
  config: z.output<typeof configSchema>;
  confirmedAt: string;
  reason: string;
  targetReasons: string[];
  status: "review_required";
  execution: "hypothetical";
  provider: string;
  timeframe: (typeof setupFrames)[number];
  method: z.output<typeof setupInputSchema>["method"];
};
const tolerance = 1e-8;
export function buildCandidate(raw: SetupInput, now: number): Candidate {
  const s = setupInputSchema.parse(raw),
    c = s.retestM5,
    buy = s.direction === "BUY";
  const end = Date.parse(c.closedAt);
  if (
    !Number.isFinite(now) ||
    end > now ||
    Date.parse(s.breakout.closedAt) > Date.parse(c.openedAt)
  )
    throw new Error("Candles must be completed and chronological");
  if (end - Date.parse(c.openedAt) !== 300_000)
    throw new Error("Confirmation must be an M5 candle");
  if (now - end > 300_000) throw new Error("Retest confirmation is stale");
  if (
    s.zoneLow > s.zoneHigh ||
    (s.zoneHigh - s.zoneLow) / s.config.pipSize >
      s.config.maxZonePips + tolerance
  )
    throw new Error("Zone exceeds configured width");
  if (s.breakoutLevel < s.zoneLow || s.breakoutLevel > s.zoneHigh)
    throw new Error("Breakout level must belong to the entry zone");
  if (
    buy
      ? s.breakout.close <= s.breakoutLevel
      : s.breakout.close >= s.breakoutLevel
  )
    throw new Error("Breakout requires a candle close beyond the left level");
  if (
    c.low > s.zoneHigh ||
    c.high < s.zoneLow ||
    (buy ? c.close <= s.breakoutLevel : c.close >= s.breakoutLevel)
  )
    throw new Error(
      "M5 retest did not touch the zone and hold the breakout level",
    );
  const sign = buy ? 1 : -1;
  // Conservative zone edge for targets/partial progress; no broker fill is claimed.
  const entry = buy ? s.zoneHigh : s.zoneLow;
  if (
    sign * (s.maximumTarget - entry) <= 0 ||
    Date.parse(s.maximumTargetConfirmedAt) > end
  )
    throw new Error(
      "Higher-timeframe target must be known and ahead of the zone",
    );
  const ahead = s.obstacles
    .filter(
      (o) =>
        Date.parse(o.confirmedAt) <= end &&
        sign * (o.price - entry) > 0 &&
        sign * (s.maximumTarget - o.price) > 0,
    )
    .sort((a, b) => sign * (a.price - b.price));
  const unique = ahead.filter(
    (o, i, a) => i === 0 || Math.abs(o.price - a[i - 1].price) > tolerance,
  );
  if (unique.length < 2)
    throw new Error(
      "Two distinct lower-timeframe roadblocks are required; targets are never fabricated",
    );
  const stop =
    (buy ? s.zoneLow : s.zoneHigh) -
    sign * s.config.slBufferPips * s.config.pipSize;
  if (stop <= 0) throw new Error("Invalid stop price");
  return {
    id: s.id,
    direction: s.direction,
    zoneLow: s.zoneLow,
    zoneHigh: s.zoneHigh,
    stop,
    targets: [unique[0].price, unique[1].price, s.maximumTarget],
    config: s.config,
    confirmedAt: c.closedAt,
    reason: s.reason,
    targetReasons: [unique[0].reason, unique[1].reason, s.maximumTargetReason],
    status: "review_required",
    execution: "hypothetical",
    provider: s.provider,
    timeframe: s.timeframe,
    method: s.method,
  };
}

export type MonitorState = {
  lastAt: number;
  lastQuoteAt?: number;
  lastM5At?: number;
  targets: number[];
  partial: boolean;
  stopped: boolean;
};
export type EngineEvent = {
  id: string;
  kind: "tp1" | "tp2" | "tp3" | "sl" | "partial_be" | "sweep";
  message: string;
  observedAt: string;
  execution: "hypothetical";
};
export const observationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("quote"),
      provider: z.string(),
      at: z.iso.datetime({ offset: true }),
      bid: z.number().positive().finite(),
      ask: z.number().positive().finite(),
    })
    .strict()
    .refine((q) => q.ask >= q.bid),
  z
    .object({
      kind: z.literal("m5"),
      provider: z.string(),
      at: z.iso.datetime({ offset: true }),
      candle: candleSchema,
      priceBasis: z.enum(["bid", "ask"]),
    })
    .strict(),
]);
export type Observation = z.input<typeof observationSchema>;
export function monitor(
  candidate: Candidate,
  previous: MonitorState,
  raw: Observation,
  now: number,
) {
  const o = observationSchema.parse(raw),
    at = Date.parse(o.at),
    buy = candidate.direction === "BUY";
  if (
    o.provider !== candidate.provider ||
    !Number.isFinite(now) ||
    at > now ||
    now - at > 60_000 ||
    at < Date.parse(candidate.confirmedAt)
  )
    throw new Error("Observation source or freshness invalid");
  const lastOfKind =
    (o.kind === "quote" ? previous.lastQuoteAt : previous.lastM5At) ??
    Date.parse(candidate.confirmedAt) - 1;
  if (previous.stopped || at < previous.lastAt || at <= lastOfKind)
    return { state: previous, events: [] as EngineEvent[] };
  const state = {
      ...previous,
      targets: [...previous.targets],
      lastAt: at,
      ...(o.kind === "quote" ? { lastQuoteAt: at } : { lastM5At: at }),
    },
    events: EngineEvent[] = [];
  const emit = (kind: EngineEvent["kind"], message: string, once = true) =>
    events.push({
      id: createHash("sha256")
        .update(`${candidate.id}:${kind}${once ? "" : ":" + o.at}`)
        .digest("hex"),
      kind,
      message,
      observedAt: o.at,
      execution: "hypothetical",
    });
  if (o.kind === "m5") {
    if (
      o.priceBasis !== (buy ? "bid" : "ask") ||
      Date.parse(o.candle.closedAt) !== at ||
      at - Date.parse(o.candle.openedAt) !== 300_000
    )
      throw new Error(
        "Stop monitoring requires the completed M5 exit-side candle",
      );
    if (
      buy ? o.candle.close < candidate.stop : o.candle.close > candidate.stop
    ) {
      state.stopped = true;
      emit(
        "sl",
        `SL invalidated: M5 closed ${buy ? "below" : "above"} the stop level.`,
      );
    } else if (
      buy ? o.candle.low < candidate.stop : o.candle.high > candidate.stop
    )
      emit(
        "sweep",
        "Possible liquidity sweep: wick crossed the stop; M5 close held. Reversal is not confirmed.",
        false,
      );
  } else {
    const price = buy ? o.bid : o.ask,
      sign = buy ? 1 : -1;
    candidate.targets.forEach((target, i) => {
      if (!state.targets.includes(i) && sign * (price - target) >= 0) {
        state.targets.push(i);
        emit(
          (["tp1", "tp2", "tp3"] as const)[i],
          `TP${i + 1} reached on the observed quote.`,
        );
      }
    });
    const baseline = buy ? candidate.zoneHigh : candidate.zoneLow;
    if (
      !state.partial &&
      (sign * (price - baseline)) / candidate.config.pipSize >
        candidate.config.partialPips
    ) {
      state.partial = true;
      emit("partial_be", "Close Partial and SET Break Even now!");
    }
  }
  return { state, events };
}
