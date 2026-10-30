import { z } from "zod";
import { TIMEFRAMES } from "../strategy";
export const DISPLAY_FRAMES = ["M5", ...TIMEFRAMES] as const;
export const frameIndex = {
  M5: 0,
  M15: 1,
  M30: 2,
  H1: 3,
  H4: 4,
  W1: 5,
  MN1: 6,
} as const;
const price = z.number().positive().finite();
export const displayBarSchema = z
  .object({
    opened_at_server_raw: z.number().int().positive(),
    open: price,
    high: price,
    low: price,
    close: price,
  })
  .refine(
    (b) =>
      b.high >= Math.max(b.open, b.close, b.low) &&
      b.low <= Math.min(b.open, b.close),
    "Invalid candle geometry",
  );
const projection = z.object({
  received_at: z.iso.datetime({ offset: true }),
  exported_at: z.iso.datetime({ offset: true }),
  source: z.literal("Vestrado MT5"),
  symbol: z.literal("XAUUSD.V"),
  timeframe: z.enum(DISPLAY_FRAMES),
  server_time_raw: z.number().int().positive(),
  quote: z
    .object({
      bid: price,
      ask: price,
      last_tick_time_raw: z.number().int().positive(),
    })
    .refine((q) => q.ask >= q.bid),
  candles: z.array(displayBarSchema).max(1000),
});
export function displaySnapshot(
  raw: unknown,
  frame: (typeof DISPLAY_FRAMES)[number],
) {
  const s = projection.parse(raw);
  if (s.timeframe !== frame)
    throw new Error("Source timeframe does not match requested frame");
  if (
    s.candles.some(
      (c, i, a) =>
        c.opened_at_server_raw >= s.server_time_raw ||
        (i > 0 && c.opened_at_server_raw <= a[i - 1].opened_at_server_raw),
    )
  )
    throw new Error("Invalid candle chronology");
  const age = s.server_time_raw - s.quote.last_tick_time_raw;
  if (age < 0) throw new Error("Future broker tick");
  return {
    symbol: s.symbol,
    timeframe: s.timeframe,
    time_basis: "broker_server" as const,
    quote: {
      bid: s.quote.bid,
      ask: s.quote.ask,
      observed_at: new Date(
        Date.parse(s.exported_at) - age * 1000,
      ).toISOString(),
      received_at: s.received_at,
      source_name: s.source,
      max_gap_seconds: 30,
    },
    bars: s.candles.slice(-100),
    exported_at: s.exported_at,
    refresh_seconds: 10,
    chart_kind: "completed_broker_candles_and_observed_bid" as const,
  };
}
export type MT5Display = ReturnType<typeof displaySnapshot>;
