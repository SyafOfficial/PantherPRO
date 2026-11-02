import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("shadow persistence freezes entry, rejects stale writers and stores events transactionally without client access", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    await db.exec(
      readFileSync("supabase/migrations/202611020012_owner_shadow.sql", "utf8"),
    );
    const id = "a".repeat(64),
      proposal = {
        id,
        mode: "shadow_only",
        status: "entry_confirmed",
        entry: 2703,
      };
    await db.query("select record_owner_shadow($1::jsonb)", [
      JSON.stringify(proposal),
    ]);
    await db.query("select record_owner_shadow($1::jsonb)", [
      JSON.stringify({ ...proposal, entry: 2704 }),
    ]);
    const row = await db.query<{ payload: typeof proposal }>(
      "select payload from owner_shadow_setups",
    );
    assert.equal(row.rows[0].payload.entry, 2703);
    const state = {
        targets: [0],
        invalidated: false,
        lastQuote: 1,
        lastClose: 0,
      },
      events = [{ id: id + ":tp1", kind: "tp1" }];
    const commit = () =>
      db.query<{ ok: boolean }>(
        "select commit_owner_shadow_progress($1,0,$2::jsonb,$3::jsonb) as ok",
        [id, JSON.stringify(state), JSON.stringify(events)],
      );
    assert.equal((await commit()).rows[0].ok, true);
    assert.equal((await commit()).rows[0].ok, false);
    assert.equal(
      (await db.query("select * from owner_shadow_events")).rows.length,
      1,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      () => db.query("select * from owner_shadow_setups"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query("select record_owner_shadow($1::jsonb)", [
          JSON.stringify(proposal),
        ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
