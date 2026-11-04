import { createHash } from "node:crypto";
import type { ForexFactoryCalendar } from "./forex-factory";
import type { ScraperEvent } from "./forex-factory-scraper";
/** Observation time is when the public weekly export was retrieved, not a claim
 * that the vendor updated an economic figure at that moment. */
export function weeklyCalendarEvents(
  calendar: ForexFactoryCalendar,
  now = Date.now(),
): ScraperEvent[] {
  const fetched = Date.parse(calendar.fetched_at);
  if (
    !Number.isFinite(fetched) ||
    fetched > now + 5000 ||
    now - fetched > 86400000
  )
    throw new Error("Weekly calendar observation is stale");
  return calendar.events.map((event) => ({
    ...event,
    id: `ffw:${createHash("sha256").update(event.id).digest("hex")}`,
    source_updated_at: new Date(fetched).toISOString(),
    actual:
      Date.parse(event.event_time) <= fetched + 5000 ? event.actual : null,
  }));
}
