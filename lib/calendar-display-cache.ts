import type { SupabaseClient } from "@supabase/supabase-js";
import {
  forexFactoryCalendar,
  type ForexFactoryCalendar,
} from "./forex-factory";
import { scraperCalendar } from "./forex-factory-scraper";
export function createCalendarDisplayRefresh(
  db: SupabaseClient,
  options: { url?: string; token?: string } = {},
  load: () => Promise<ForexFactoryCalendar> = async () => {
    if (options.url)
      try {
        return await scraperCalendar(options.url, options.token);
      } catch {
        /* Public weekly source remains an independent fallback. */
      }
    return forexFactoryCalendar();
  },
) {
  let next = 0;
  let running: Promise<void> | null = null;
  return function refresh(now = Date.now()): Promise<void> {
    if (running) return running;
    if (now < next) return Promise.resolve();
    next = now + (options.url ? 5 : 15) * 60000;
    running = (async () => {
      try {
        const payload = {
          ...(await load()),
          refresh_seconds: options.url ? 300 : 900,
        };
        const { error } = await db
          .from("calendar_display_cache")
          .upsert({ singleton: true, payload, fetched_at: payload.fetched_at });
        if (error) throw new Error("Calendar cache write failed");
      } catch (error) {
        next = now + 60000;
        throw error;
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
