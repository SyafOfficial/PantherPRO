import { z } from "zod";

export const FOREX_FACTORY_FEED =
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
export const FOREX_FACTORY_PAGE = "https://www.forexfactory.com/calendar";
export const CALENDAR_REFRESH_SECONDS = 3600;

const rowSchema = z.object({
  title: z.string().trim().min(1).max(200),
  country: z.string(),
  date: z.iso.datetime({ offset: true }),
  impact: z.enum(["Low", "Medium", "High", "Holiday"]),
  forecast: z.string().max(100).nullish(),
  previous: z.string().max(100).nullish(),
  actual: z.string().max(100).nullish(),
});
export type ForexFactoryEvent = {
  id: string;
  name: string;
  event_time: string;
  importance: "low" | "medium" | "high" | "holiday";
  previous: string | null;
  forecast: string | null;
  actual: string | null;
};
export function parseForexFactory(value: unknown): ForexFactoryEvent[] {
  if (!Array.isArray(value) || value.length > 2000)
    throw new Error("Invalid calendar response");
  const events: ForexFactoryEvent[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success || parsed.data.country !== "USD") continue;
    const r = parsed.data;
    const date = new Date(r.date);
    if (!Number.isFinite(date.getTime())) continue;
    const event_time = date.toISOString();
    const id = `${event_time}:${r.title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const figure = (v: string | null | undefined) => v?.trim() || null;
    events.push({
      id,
      name: r.title,
      event_time,
      importance: r.impact.toLowerCase() as ForexFactoryEvent["importance"],
      previous: figure(r.previous),
      forecast: figure(r.forecast),
      actual: figure(r.actual),
    });
  }
  if (value.length && !events.length)
    throw new Error("No valid USD calendar records");
  return events.sort((a, b) => a.event_time.localeCompare(b.event_time));
}
export async function forexFactoryCalendar(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const response = await fetcher(FOREX_FACTORY_FEED, {
    redirect: "error",
    signal: AbortSignal.timeout(6000),
    next: { revalidate: CALENDAR_REFRESH_SECONDS },
  });
  if (!response.ok) throw new Error("Calendar source unavailable");
  const limit = 1048576;
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    throw new Error("Calendar too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty calendar");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > limit) throw new Error("Calendar too large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {
    source_name: "Forex Factory",
    source_url: FOREX_FACTORY_PAGE,
    fetched_at: new Date(now).toISOString(),
    refresh_seconds: CALENDAR_REFRESH_SECONDS,
    events: parseForexFactory(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    ),
  };
}
export type ForexFactoryCalendar = Awaited<
  ReturnType<typeof forexFactoryCalendar>
>;
