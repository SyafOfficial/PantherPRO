import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { hnsSnapshot } from "./helpers/hns-fixture";
import { scanHns } from "../lib/engine/hns";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
test("HNS SQL geometry validator matches the scanner for both directions and neckline slopes", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role;",
    );
    await db.exec(
      (
        await readFile(
          "supabase/migrations/20261106172019_hns_break_retest_strategy.sql",
          "utf8",
        )
      )
        .split("alter table public.signals")[0]
        .replace("begin;", ""),
    );
    const now = Date.now();
    for (const buy of [true, false])
      for (const slope of [0, 0.05]) {
        const s = mt5SnapshotSchema.parse(hnsSnapshot(buy, slope, now)),
          p = scanHns(s, now)[0];
        assert.ok(p);
        const valid = async (plan: unknown) =>
          (
            await db.query<{ v: boolean }>(
              "select public.valid_hns_plan($1,$2) v",
              [JSON.stringify(s), JSON.stringify(plan)],
            )
          ).rows[0].v;
        assert.equal(await valid(p), true, `${buy} ${slope}`);
        assert.equal(await valid({ ...p, stop: p.stop + 1 }), false);
      }
  } finally {
    await db.close();
  }
});
