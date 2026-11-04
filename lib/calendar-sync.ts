import type { SupabaseClient } from "@supabase/supabase-js";
import { scraperCalendar, importScraperEvents } from "./forex-factory-scraper";
import {
  forexFactoryCalendar,
  CalendarSourceError,
  type ForexFactoryCalendar,
} from "./forex-factory";
import { weeklyCalendarEvents } from "./calendar-weekly";

export function createCalendarSync(
  db: SupabaseClient,
  options: {
    url?: string;
    token?: string;
    providerId?: string;
    source?: "weekly" | "scraper";
  },
  load = scraperCalendar,
  loadWeekly: () => Promise<ForexFactoryCalendar> = forexFactoryCalendar,
) {
  let nextFetch = 0;
  let nextQueue = 0;
  let readyUntil = 0;
  return async (now = Date.now()) => {
    const weekly = options.source === "weekly";
    if ((!weekly && !options.url) || !options.providerId)
      return { configured: false };
    const refreshMs = weekly ? 3600000 : 300000;
    let imported = 0;
    if (now >= nextFetch) {
      nextFetch = now + refreshMs;
      readyUntil = 0;
      try {
        const calendar = weekly
          ? await loadWeekly()
          : await load(options.url!, options.token);
        const events = weekly
          ? weeklyCalendarEvents(calendar, now)
          : (calendar as Awaited<ReturnType<typeof scraperCalendar>>).events;
        imported = await importScraperEvents(db, options.providerId, events);
        if (weekly) {
          const { error } = await db.from("calendar_display_cache").upsert({
            singleton: true,
            payload: calendar,
            fetched_at: calendar.fetched_at,
          });
          if (error) throw new Error("Calendar cache write failed");
        }
        readyUntil = Math.min(
          now + refreshMs,
          ...events.map(
            (event) => Date.parse(event.source_updated_at) + 86400000,
          ),
        );
      } catch (error) {
        if (weekly)
          nextFetch =
            error instanceof CalendarSourceError ? error.retryAt : now + 60000;
        throw error;
      }
    }
    if (now < readyUntil && now >= nextQueue) {
      nextQueue = now + 30000;
      const { error } = await db.rpc("queue_upcoming_calendar_events");
      if (error) throw new Error("Calendar reminder queue unavailable");
    }
    return {
      configured: true,
      imported,
      source: weekly ? "weekly" : "scraper",
    };
  };
}
