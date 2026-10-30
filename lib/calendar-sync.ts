import type { SupabaseClient } from "@supabase/supabase-js";
import { scraperCalendar, importScraperEvents } from "./forex-factory-scraper";

export function createCalendarSync(
  db: SupabaseClient,
  options: {
    url?: string;
    token?: string;
    providerId?: string;
  },
  load = scraperCalendar,
) {
  let nextFetch = 0;
  let nextQueue = 0;
  let readyUntil = 0;
  return async (now = Date.now()) => {
    if (!options.url || !options.providerId) return { configured: false };
    let imported = 0;
    if (now >= nextFetch) {
      nextFetch = now + 300000;
      readyUntil = 0;
      const calendar = await load(options.url, options.token);
      imported = await importScraperEvents(
        db,
        options.providerId,
        calendar.events,
      );
      readyUntil = Math.min(
        now + 300000,
        ...calendar.events.map(
          (event) => Date.parse(event.source_updated_at) + 86400000,
        ),
      );
    }
    if (now < readyUntil && now >= nextQueue) {
      nextQueue = now + 30000;
      const { error } = await db.rpc("queue_upcoming_calendar_events");
      if (error) throw new Error("Calendar reminder queue unavailable");
    }
    return { configured: true, imported };
  };
}
