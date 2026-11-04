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
    const figure = (v: string | null | undefined) =>
      !v?.trim() || ["empty", "n/a", "-", "—"].includes(v.trim().toLowerCase())
        ? null
        : v.trim();
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
export class CalendarSourceError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAt: number,
  ) {
    super(`Calendar source HTTP ${status}`);
  }
}
function sourceRetryAt(response: Response, now: number) {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  const supplied = /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : Date.parse(value);
  const fallback = now + (response.status === 429 ? 3600000 : 600000);
  return Math.max(
    now + 600000,
    Number.isFinite(supplied) ? supplied : fallback,
  );
}
async function fetchWeeklyCalendar(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const response = await fetcher(FOREX_FACTORY_FEED, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "PantherPRO-Calendar/1.0",
    },
  });
  if (!response.ok)
    throw new CalendarSourceError(
      response.status,
      sourceRetryAt(response, now),
    );
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
  const events = parseForexFactory(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  if (
    events.length &&
    !events.some(
      (event) => Math.abs(Date.parse(event.event_time) - now) <= 8 * 86400000,
    )
  )
    throw new Error("Calendar week is stale");
  return {
    source_name: "Forex Factory",
    source_url: FOREX_FACTORY_PAGE,
    fetched_at: new Date(now).toISOString(),
    refresh_seconds: CALENDAR_REFRESH_SECONDS,
    events,
  };
}
let cached: Awaited<ReturnType<typeof fetchWeeklyCalendar>> | null = null;
let pending: ReturnType<typeof fetchWeeklyCalendar> | null = null;
let retryAt = 0;
let failure: Error | null = null;
/** Shared hourly fetch per process, including worker display and ingestion. */
export function forexFactoryCalendar(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  // Explicit fetchers remain isolated for deterministic parser/transport tests.
  if (fetcher !== fetch) return fetchWeeklyCalendar(fetcher, now);
  if (
    cached &&
    now - Date.parse(cached.fetched_at) < CALENDAR_REFRESH_SECONDS * 1000
  )
    return Promise.resolve(cached);
  if (pending) return pending;
  if (now < retryAt && failure) return Promise.reject(failure);
  pending = fetchWeeklyCalendar(fetcher, now)
    .then((value) => {
      cached = value;
      failure = null;
      retryAt = 0;
      return value;
    })
    .catch((error: unknown) => {
      failure =
        error instanceof Error
          ? error
          : new Error("Calendar source unavailable");
      retryAt =
        error instanceof CalendarSourceError ? error.retryAt : now + 10 * 60000;
      throw failure;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
export function calendarFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = /^Calendar source HTTP (\d{3})$/.exec(message);
  if (error instanceof CalendarSourceError)
    return {
      reason: "upstream_http",
      status: error.status,
      retry_at: new Date(error.retryAt).toISOString(),
    };
  return status
    ? { reason: "upstream_http", status: Number(status[1]) }
    : { reason: "source_or_import_unavailable" };
}
export type ForexFactoryCalendar = Awaited<
  ReturnType<typeof forexFactoryCalendar>
> & { cache_status?: "fresh" | "stale" };
