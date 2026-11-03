import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCalendarDisplayRefresh } from "../lib/calendar-display-cache";
import type { ForexFactoryCalendar } from "../lib/forex-factory";
const value: ForexFactoryCalendar = {
  source_name: "Forex Factory",
  source_url: "https://www.forexfactory.com/calendar",
  fetched_at: "2026-11-03T17:00:00Z",
  refresh_seconds: 3600,
  events: [],
};
test("display refresh deduplicates fetches, retains last success on failure and retries after a minute", async () => {
  let stored: unknown;
  let calls = 0;
  let fail = false;
  const db = {
    from: () => ({
      upsert: async (row: unknown) => {
        stored = row;
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const refresh = createCalendarDisplayRefresh(db, {}, async () => {
    calls++;
    if (fail) throw new Error("Upstream down");
    return value;
  });
  const first = refresh(0);
  assert.equal(refresh(0), first);
  await first;
  assert.equal(calls, 1);
  const saved = stored;
  await refresh(1000);
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(refresh(900000));
  assert.equal(stored, saved);
  await refresh(930000);
  assert.equal(calls, 2);
  fail = false;
  await refresh(960000);
  assert.equal(calls, 3);
  assert.equal(
    (stored as { payload: ForexFactoryCalendar }).payload.fetched_at,
    value.fetched_at,
  );
});
test("persisted display cache is service-only and private to anonymous and signed-in clients", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;",
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261103173233_calendar_display_cache.sql",
        "utf8",
      ),
    );
    await db.exec("set role service_role");
    await db.query(
      "insert into public.calendar_display_cache(singleton,payload,fetched_at) values(true,$1,now())",
      [value],
    );
    assert.equal(
      (await db.query("select * from public.calendar_display_cache")).rows
        .length,
      1,
    );
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role;set role ${role}`);
      await assert.rejects(
        db.query("select * from public.calendar_display_cache"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("delete from public.calendar_display_cache"),
        /permission denied/,
      );
    }
  } finally {
    await db.close();
  }
});
