import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarEventSchema } from "./market-data";
import { FOREX_FACTORY_PAGE, type ForexFactoryEvent } from "./forex-factory";

const scraperRow = z.object({
  event_id: z.string().min(1).max(180),
  event_time: z.iso.datetime({ offset: true }),
  scraped_at: z.iso.datetime({ offset: true }),
  currency: z.string(),
  event: z.string().trim().min(1).max(200),
  impact: z.enum(["red", "orange", "yellow", "gray"]),
  actual: z.string().max(100).nullish(),
  forecast: z.string().max(100).nullish(),
  previous: z.string().max(100).nullish(),
});
export type ScraperEvent = ForexFactoryEvent & { source_updated_at: string };
export function parseScraperEvents(
  value: unknown,
  now = Date.now(),
): ScraperEvent[] {
  if (!Array.isArray(value) || value.length > 5000)
    throw new Error("Invalid scraper calendar");
  const seen = new Set<string>();
  const result: ScraperEvent[] = [];
  for (const raw of value) {
    const parsed = scraperRow.safeParse(raw);
    if (!parsed.success || parsed.data.currency !== "USD") continue;
    const row = parsed.data;
    const observed = Date.parse(row.scraped_at);
    const eventTime = Date.parse(row.event_time);
    if (
      !Number.isFinite(observed) ||
      !Number.isFinite(eventTime) ||
      observed > now + 5000 ||
      now - observed > 86400000
    )
      continue;
    const figure = (v: string | null | undefined) =>
      !v?.trim() || ["empty", "n/a", "-", "—"].includes(v.trim().toLowerCase())
        ? null
        : v.trim();
    const actual = figure(row.actual);
    if (actual !== null && eventTime > observed + 5000) continue;
    const id = `ff:${row.event_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name: row.event,
      event_time: new Date(eventTime).toISOString(),
      source_updated_at: new Date(observed).toISOString(),
      importance: (
        {
          red: "high",
          orange: "medium",
          yellow: "low",
          gray: "holiday",
        } as const
      )[row.impact],
      actual,
      forecast: figure(row.forecast),
      previous: figure(row.previous),
    });
  }
  if (value.length && !result.length)
    throw new Error("Scraper returned no fresh valid USD records");
  return result.sort((a, b) => a.event_time.localeCompare(b.event_time));
}

export async function scraperCalendar(
  base: string,
  token?: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const url = new URL(base);
  const privateHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".internal"));
  if (
    (!privateHttp && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use a private HTTP or HTTPS scraper origin");
  url.pathname = "/events";
  url.search = "currency=USD&limit=5000";
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Scraper API unavailable");
  const limit = 1048576;
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    throw new Error("Scraper response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty scraper response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > limit) throw new Error("Scraper response too large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {
    source_name: "Forex Factory · scraper",
    source_url: FOREX_FACTORY_PAGE,
    fetched_at: new Date(now).toISOString(),
    refresh_seconds: 300,
    events: parseScraperEvents(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      now,
    ),
  };
}

// Existing provider permissions, revision checks and notification deduplication
// remain enforced by the database; this adapter never changes those flags.
export async function importScraperEvents(
  db: SupabaseClient,
  providerId: string,
  events: ScraperEvent[],
) {
  const rows = events
    .filter((e) => e.importance !== "holiday")
    .map((e) =>
      calendarEventSchema.parse({
        provider_id: providerId,
        reference: e.id,
        name: e.name,
        country: "United States",
        currency: "USD",
        event_time: e.event_time,
        previous: e.previous,
        forecast: e.forecast,
        actual: e.actual,
        importance: e.importance,
        source_updated_at: e.source_updated_at,
        source_url: FOREX_FACTORY_PAGE,
      }),
    );
  let stored = 0;
  for (const observation of rows) {
    const { error } = await db.rpc("ingest_calendar_event", { observation });
    if (error)
      throw new Error(
        "Calendar import rejected; check provider registration or revision timestamps",
      );
    stored++;
  }
  return stored;
}
