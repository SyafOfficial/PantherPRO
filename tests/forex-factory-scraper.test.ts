import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseScraperEvents,
  scraperCalendar,
  importScraperEvents,
} from "../lib/forex-factory-scraper";
import { createCalendarSync } from "../lib/calendar-sync";
const now = Date.parse("2026-10-30T12:00:00Z");
const row = {
  event_id: "cpi-123",
  event_time: "2026-10-30T08:30:00-04:00",
  scraped_at: "2026-10-30T11:55:00Z",
  currency: "USD",
  event: "Core CPI m/m",
  impact: "red",
  actual: "empty",
  previous: "0.2%",
  forecast: "0.3%",
};
test("toolkit API normalization preserves stable IDs, source timestamps and missing figures", () => {
  const events = parseScraperEvents(
    [row, row, { ...row, currency: "EUR" }],
    now,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "ff:cpi-123");
  assert.equal(events[0].event_time, "2026-10-30T12:30:00.000Z");
  assert.equal(events[0].source_updated_at, "2026-10-30T11:55:00.000Z");
  assert.equal(events[0].actual, null);
  assert.equal(events[0].importance, "high");
});
test("stale, unzoned and premature actual figures cannot be displayed as fresh facts", () => {
  for (const invalid of [
    { ...row, scraped_at: "2026-10-28T11:55:00Z" },
    { ...row, event_time: "2026-10-30T08:30:00" },
    { ...row, actual: "0.4%" },
  ])
    assert.throws(() => parseScraperEvents([invalid], now));
});
test("scraper fetch is bounded, fixed to events and never follows credential redirects", async () => {
  const fetcher = (async (url, options) => {
    assert.equal(
      String(url),
      "http://calendar.internal:8765/events?currency=USD&limit=5000",
    );
    assert.equal(options?.redirect, "error");
    return new Response(JSON.stringify([row]));
  }) as typeof fetch;
  const calendar = await scraperCalendar(
    "http://calendar.internal:8765",
    undefined,
    fetcher,
    now,
  );
  assert.equal(calendar.events.length, 1);
  await assert.rejects(() =>
    scraperCalendar("http://public.example", undefined, fetcher, now),
  );
  await assert.rejects(() =>
    scraperCalendar("https://example.test/custom", undefined, fetcher, now),
  );
  await assert.rejects(() =>
    scraperCalendar(
      "https://example.test",
      undefined,
      (async () =>
        new Response("x", {
          headers: { "content-length": "1048577" },
        })) as typeof fetch,
      now,
    ),
  );
});
test("import uses source timestamp and existing RPC permissions; holidays never become economic alerts", async () => {
  const calls: { name: string; observation: any }[] = [];
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, observation: args?.observation });
      return { error: null };
    },
  } as unknown as SupabaseClient;
  const events = parseScraperEvents(
    [row, { ...row, event_id: "holiday", impact: "gray" }],
    now,
  );
  assert.equal(
    await importScraperEvents(
      db,
      "11111111-1111-4111-8111-111111111111",
      events,
    ),
    1,
  );
  assert.equal(calls[0].name, "ingest_calendar_event");
  assert.equal(
    calls[0].observation.source_updated_at,
    "2026-10-30T11:55:00.000Z",
  );
  assert.equal(calls[0].observation.actual, null);
  const denied = {
    rpc: async () => ({ error: { message: "disabled provider" } }),
  } as unknown as SupabaseClient;
  await assert.rejects(() =>
    importScraperEvents(denied, "11111111-1111-4111-8111-111111111111", events),
  );
});
test("worker polls scraper at five-minute intervals while reminders are queued every thirty seconds", async () => {
  let loads = 0,
    queues = 0;
  const db = {
    rpc: async (name: string) => {
      if (name === "queue_upcoming_calendar_events") queues++;
      return { error: null };
    },
  } as unknown as SupabaseClient;
  const load = async () => {
    loads++;
    return {
      source_name: "test",
      source_url: "https://www.forexfactory.com/calendar",
      fetched_at: new Date(now).toISOString(),
      refresh_seconds: 300,
      events: [],
    };
  };
  const sync = createCalendarSync(
    db,
    {
      url: "http://calendar.internal:8765",
      providerId: "11111111-1111-4111-8111-111111111111",
    },
    load,
  );
  await sync(now);
  await sync(now + 1000);
  await sync(now + 30000);
  assert.equal(loads, 1);
  assert.equal(queues, 2);
  await sync(now + 300000);
  assert.equal(loads, 2);
  const off = createCalendarSync(db, {}, load);
  assert.deepEqual(await off(now), { configured: false });
});
test("failed scraper refresh does not queue reminders from retained stale records", async () => {
  let queues = 0,
    loads = 0;
  const db = {
    rpc: async () => {
      queues++;
      return { error: null };
    },
  } as unknown as SupabaseClient;
  const sync = createCalendarSync(
    db,
    {
      url: "http://calendar.internal:8765",
      providerId: "11111111-1111-4111-8111-111111111111",
    },
    async () => {
      loads++;
      throw new Error("Source down");
    },
  );
  await assert.rejects(() => sync(now));
  await sync(now + 30000);
  assert.equal(loads, 1);
  assert.equal(queues, 0);
});
