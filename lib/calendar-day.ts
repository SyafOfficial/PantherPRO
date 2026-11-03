import type { ForexFactoryEvent } from "./forex-factory";
export type ImpactFilter = "all" | "low" | "medium" | "high";
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function malaysiaDay(time: number | string) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid calendar time");
  const parts = dateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function shiftCalendarDay(day: string, offset: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid calendar day");
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function dailyCalendar(
  events: ForexFactoryEvent[],
  day: string,
  impact: ImpactFilter = "all",
) {
  const all = events
    .filter((e) => malaysiaDay(e.event_time) === day)
    .sort((a, b) => a.event_time.localeCompare(b.event_time));
  return {
    events: all.filter((e) => impact === "all" || e.importance === impact),
    total: all.length,
    counts: {
      high: all.filter((e) => e.importance === "high").length,
      medium: all.filter((e) => e.importance === "medium").length,
      low: all.filter((e) => e.importance === "low").length,
    },
  };
}
export function calendarWeekOutdated(
  events: ForexFactoryEvent[],
  today: string,
) {
  if (!events.length) return false;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = shiftCalendarDay(today, -((weekday + 6) % 7));
  return events.every((e) => malaysiaDay(e.event_time) < monday);
}
