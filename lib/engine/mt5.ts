import { z } from "zod";
const price = z.number().positive().finite();
const rawTime = z.number().int().positive().safe();
const frames = ["M5", "M15", "M30", "H1", "H4", "W1", "MN1"] as const;
const bar = z
  .object({
    opened_at_server_raw: rawTime,
    open: price,
    high: price,
    low: price,
    close: price,
    tick_volume: z.number().int().nonnegative().safe(),
    real_volume: z.number().nonnegative().finite().nullable(),
    spread_points: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (c) =>
      c.low <= Math.min(c.open, c.close) &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= c.high,
    "Invalid candle geometry",
  );
const series = z
  .object({
    timeframe: z.enum(frames),
    availability: z.enum(["available", "unavailable"]),
    candles: z.array(bar).max(1000),
  })
  .strict()
  .superRefine((s, c) => {
    if ((s.availability === "available") !== s.candles.length > 0)
      c.addIssue({
        code: "custom",
        message: "Availability must match exported bars",
      });
    if (
      s.candles.some(
        (v, i, a) =>
          i > 0 && v.opened_at_server_raw <= a[i - 1].opened_at_server_raw,
      )
    )
      c.addIssue({
        code: "custom",
        message: "Candle times must increase without duplicates",
      });
  });
function barClose(frame: (typeof frames)[number], opened: number) {
  if (frame === "MN1") {
    const date = new Date(opened * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  }
  return (
    opened +
    (
      { M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, W1: 604800 } as const
    )[frame]
  );
}
export const mt5SnapshotSchema = z
  .object({
    schema: z.literal("panther.mt5.snapshot.v1"),
    provider: z.literal("Vestrado MT5"),
    symbol: z.literal("XAUUSD.V"),
    exported_at_utc: z
      .string()
      .regex(/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/),
    bar_time_basis: z.literal("broker_server"),
    server_time_raw: rawTime,
    digits: z.number().int().min(0).max(10),
    point: price,
    quote: z
      .object({
        bid: price,
        ask: price,
        last_tick_time_raw: rawTime,
        last_tick_time_msc_raw: rawTime,
      })
      .strict()
      .refine(
        (q) =>
          q.ask >= q.bid &&
          Math.floor(q.last_tick_time_msc_raw / 1000) === q.last_tick_time_raw,
        "Invalid tick or spread",
      ),
    series: z.array(series).length(7),
    ask_m5: z.array(bar).max(100).optional(),
    order_book: z
      .object({
        scope: z.literal("broker_reported_only"),
        levels: z
          .array(
            z
              .object({
                type: z.number().int(),
                price: z.number().nonnegative().finite(),
                volume: z.number().nonnegative().finite(),
                volume_real: z.number().nonnegative().finite(),
              })
              .strict(),
          )
          .max(1000),
      })
      .strict()
      .nullable(),
    aggressive_buy_sell_imbalance: z.null(),
    execution_enabled: z.literal(false),
  })
  .strict()
  .superRefine((s, c) => {
    if (new Set(s.series.map((v) => v.timeframe)).size !== 7)
      c.addIssue({
        code: "custom",
        message: "Missing or duplicated timeframes",
      });
    if (Math.abs(s.point - 10 ** -s.digits) > 1e-12)
      c.addIssue({
        code: "custom",
        message: "Point and digit precision disagree",
      });
    const asks = s.ask_m5 ?? [];
    if (
      asks.some(
        (b, i) =>
          b.opened_at_server_raw + 300 > s.server_time_raw ||
          (i > 0 && b.opened_at_server_raw <= asks[i - 1].opened_at_server_raw),
      )
    )
      c.addIssue({
        code: "custom",
        message: "Ask M5 history must be completed and chronological",
      });
    for (const v of s.series)
      for (const b of v.candles)
        if (barClose(v.timeframe, b.opened_at_server_raw) > s.server_time_raw)
          c.addIssue({ code: "custom", message: "Unfinished or future bar" });
  });
export function snapshotUtc(value: string) {
  const normalized =
    value
      .replace(/\./g, "T")
      .replace("T", "-")
      .replace("T", "-")
      .replace(" ", "T") + "Z";
  const time = Date.parse(normalized);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 19) !== normalized.slice(0, 19)
  )
    throw new Error("Invalid UTC export time");
  return time;
}
export function inspectMt5Snapshot(raw: unknown, now: number) {
  const s = mt5SnapshotSchema.parse(raw),
    exportedAt = snapshotUtc(s.exported_at_utc);
  if (!Number.isFinite(now)) throw new Error("Current time required");
  const ageMs = now - exportedAt;
  const brokerTickAgeSeconds = s.server_time_raw - s.quote.last_tick_time_raw;
  const currentOffsetSeconds = s.server_time_raw - exportedAt / 1000;
  return {
    schema: s.schema,
    symbol: s.symbol,
    provider: s.provider,
    quote: {
      bid: s.quote.bid,
      ask: s.quote.ask,
      spread: Number((s.quote.ask - s.quote.bid).toFixed(s.digits)),
      brokerTickAgeSeconds,
    },
    freshness: {
      exportAgeMs: ageMs,
      usableCurrentQuote:
        ageMs >= 0 &&
        ageMs <= 30_000 &&
        brokerTickAgeSeconds >= 0 &&
        brokerTickAgeSeconds <= 60,
    },
    timing: {
      observedCurrentOffsetSeconds: currentOffsetSeconds,
      historicalUtcConversion: "not_verified" as const,
    },
    series: s.series.map((v) => ({
      timeframe: v.timeframe,
      bars: v.candles.length,
      availability: v.availability,
      tickVolumeAvailable: v.candles.length > 0,
      latestRealVolumeAvailable: v.candles.at(-1)?.real_volume != null,
    })),
    liquidity: {
      orderBook: s.order_book === null ? "unavailable" : "broker_reported_only",
      aggressiveBuySellImbalance: "unavailable" as const,
    },
    pipSize: "requires_broker_convention_confirmation" as const,
    signalEngineConnected: false,
    executionEnabled: false,
  };
}
