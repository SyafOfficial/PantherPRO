import { test } from "node:test";
import assert from "node:assert/strict";
import {
  malaysiaDay,
  shiftCalendarDay,
  dailyCalendar,
  calendarWeekOutdated,
} from "../lib/calendar-day";
import type { ForexFactoryEvent } from "../lib/forex-factory";
const event = (
  time: string,
  impact: ForexFactoryEvent["importance"],
): ForexFactoryEvent => ({
  id: time + impact,
  event_time: time,
  importance: impact,
  name: "USD release",
  actual: null,
  previous: null,
  forecast: null,
});
test("Today rolls at Malaysia midnight, independent of UTC and year boundaries", () => {
  assert.equal(malaysiaDay("2026-11-03T15:59:59Z"), "2026-11-03");
  assert.equal(malaysiaDay("2026-11-03T16:00:00Z"), "2026-11-04");
  assert.equal(malaysiaDay("2026-12-31T16:00:00Z"), "2027-01-01");
  assert.equal(shiftCalendarDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftCalendarDay("2026-03-01", -1), "2026-02-28");
});
test("daily impact filters retain exact source figures and do not leak yesterday's events", () => {
  const events = [
    event("2026-11-03T15:59:59Z", "high"),
    event("2026-11-03T16:00:00Z", "low"),
    event("2026-11-04T12:30:00Z", "high"),
    event("2026-11-04T10:00:00Z", "medium"),
  ];
  const today = dailyCalendar(events, "2026-11-04");
  assert.equal(today.total, 3);
  assert.deepEqual(today.counts, { high: 1, medium: 1, low: 1 });
  assert.equal(dailyCalendar(events, "2026-11-04", "high").events.length, 1);
  assert.equal(today.events[0].importance, "low");
  assert.equal(today.events[2].actual, null);
  assert.equal(dailyCalendar(events, "2026-11-05").events.length, 0);
});
test("old weekly source schedule is flagged without treating weekends as source failures", () => {
  const friday = [event("2026-11-06T13:30:00Z", "high")];
  assert.equal(calendarWeekOutdated(friday, "2026-11-08"), false);
  assert.equal(calendarWeekOutdated(friday, "2026-11-09"), true);
  assert.equal(calendarWeekOutdated([], "2026-11-09"), false);
});
