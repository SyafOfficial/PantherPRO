import { z } from "zod";
export const quoteSchema = z
  .object({
    provider_id: z.uuid(),
    reference: z.string().trim().min(1).max(200),
    instrument: z.literal("XAUUSD"),
    bid: z.number().positive().finite(),
    ask: z.number().positive().finite(),
    observed_at: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((q) => q.ask >= q.bid, { message: "Ask must be at least bid" });
export const calendarEventSchema = z
  .object({
    provider_id: z.uuid(),
    reference: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    country: z.literal("United States"),
    currency: z.literal("USD"),
    event_time: z.iso.datetime({ offset: true }),
    previous: z.string().trim().min(1).max(100).nullable(),
    forecast: z.string().trim().min(1).max(100).nullable(),
    actual: z.string().trim().min(1).max(100).nullable(),
    importance: z.enum(["low", "medium", "high"]),
    source_updated_at: z.iso.datetime({ offset: true }),
    source_url: z.url().refine((v) => {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && !u.port;
    }),
  })
  .strict();
export type LicensedQuote = z.infer<typeof quoteSchema> & {
  id: string;
  source_name: string;
  received_at: string;
  max_gap_seconds: number;
};
export type CalendarEvent = z.infer<typeof calendarEventSchema> & {
  id: string;
  source_name: string;
  received_at: string;
  version: number;
};
export function quoteFreshness(
  quote: Pick<LicensedQuote, "observed_at" | "received_at" | "max_gap_seconds">,
  now: number,
) {
  const observed = Date.parse(quote.observed_at),
    received = Date.parse(quote.received_at);
  return (
    Number.isFinite(observed) &&
    Number.isFinite(received) &&
    observed <= now + 5000 &&
    received <= now + 5000 &&
    now - observed <= quote.max_gap_seconds * 1000 &&
    now - received <= quote.max_gap_seconds * 1000
  );
}
export function malaysiaTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export type MarketSnapshot = {
  quote: LicensedQuote | null;
  events: CalendarEvent[];
  as_of: string;
};
