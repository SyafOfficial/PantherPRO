import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { weeklyCalendarEvents } from "../lib/calendar-weekly";
import { createCalendarSync } from "../lib/calendar-sync";
import {
  forexFactoryCalendar,
  calendarFailure,
  type ForexFactoryCalendar,
} from "../lib/forex-factory";
const now = Date.parse("2026-11-04T12:00:00Z");
const calendar: ForexFactoryCalendar = {
  source_name: "Forex Factory",
  source_url: "https://www.forexfactory.com/calendar",
  fetched_at: new Date(now).toISOString(),
  refresh_seconds: 3600,
  events: [
    {
      id: "event",
      name: "CPI",
      event_time: "2026-11-04T12:30:00Z",
      importance: "high",
      forecast: "2.5%",
      previous: "2.4%",
      actual: null,
    },
  ],
};
test("weekly observations retain source figures, bounded identity and explicit retrieval time", () => {
  const [e] = weeklyCalendarEvents(calendar, now);
  assert.equal(e.forecast, "2.5%");
  assert.equal(e.actual, null);
  assert.equal(e.source_updated_at, calendar.fetched_at);
  assert.match(e.id, /^ffw:[a-f0-9]{64}$/);
  assert.equal(weeklyCalendarEvents(calendar, now)[0].id, e.id);
  assert.throws(() => weeklyCalendarEvents(calendar, now + 86400001));
  const early = {
    ...calendar,
    events: [{ ...calendar.events[0], actual: "3%" }],
  };
  assert.equal(weeklyCalendarEvents(early, now)[0].actual, null);
});
test("weekly worker imports and caches one schedule, then queues reminders independently", async () => {
  const observations: any[] = [];
  let caches = 0,
    queues = 0,
    loads = 0;
  const db = {
    rpc: async (name: string, args: any) => {
      if (name === "ingest_calendar_event") observations.push(args.observation);
      else queues++;
      return { error: null };
    },
    from: () => ({
      upsert: async () => {
        caches++;
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const sync = createCalendarSync(
    db,
    { source: "weekly", providerId: "11111111-1111-4111-8111-111111111111" },
    undefined,
    async () => {
      loads++;
      return calendar;
    },
  );
  assert.equal((await sync(now)).imported, 1);
  await sync(now + 30000);
  await sync(now + 3599000);
  assert.equal(loads, 1);
  assert.equal(caches, 1);
  assert.equal(queues, 3);
  assert.equal(observations[0].country, "United States");
  assert.equal(observations[0].currency, "USD");
  await sync(now + 3600000);
  assert.equal(loads, 2);
});
test("weekly source failure cannot produce imports or reminders", async () => {
  let writes = 0;
  const db = {
    rpc: async () => {
      writes++;
      return { error: null };
    },
  } as unknown as SupabaseClient;
  const sync = createCalendarSync(
    db,
    { source: "weekly", providerId: "11111111-1111-4111-8111-111111111111" },
    undefined,
    async () => {
      throw new Error("Calendar source HTTP 429");
    },
  );
  await assert.rejects(() => sync(now));
  await sync(now + 30000);
  assert.equal(writes, 0);
  assert.deepEqual(calendarFailure(new Error("Calendar source HTTP 429")), {
    reason: "upstream_http",
    status: 429,
  });
  assert.deepEqual(calendarFailure(new Error("private token value")), {
    reason: "source_or_import_unavailable",
  });
});
test("default weekly source shares in-flight fetch and successful hourly cache", async () => {
  const original = globalThis.fetch;
  let loads = 0;
  globalThis.fetch = (async () => {
    loads++;
    return new Response(
      JSON.stringify([
        {
          title: "CPI",
          country: "USD",
          date: "2026-11-04T12:30:00Z",
          impact: "High",
          forecast: "2.5%",
          previous: "2.4%",
        },
      ]),
    );
  }) as typeof fetch;
  try {
    const a = forexFactoryCalendar(globalThis.fetch, now),
      b = forexFactoryCalendar(globalThis.fetch, now);
    assert.equal(a, b);
    await a;
    await forexFactoryCalendar(globalThis.fetch, now + 1000);
    assert.equal(loads, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("an old weekly schedule cannot be labelled as current merely because it was fetched now", async () => {
  await assert.rejects(
    () =>
      forexFactoryCalendar(
        (async () =>
          new Response(
            JSON.stringify([
              {
                title: "CPI",
                country: "USD",
                date: "2024-01-01T12:30:00Z",
                impact: "High",
              },
            ]),
          )) as typeof fetch,
        now,
      ),
    /Calendar week is stale/,
  );
});
