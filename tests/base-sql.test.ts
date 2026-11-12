import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { baseSnapshot } from "./helpers/base-fixture";
import { scanBaseRetests } from "../lib/engine/base-retest";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
test("SQL recomputes origin base, structural trigger, directional rejection and wick stop for mirrored BOS/CHOCH", async () => {
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
    await db.exec(
      (
        await readFile(
          "supabase/migrations/20261112065059_structure_base_retest_wick_stop.sql",
          "utf8",
        )
      )
        .split("-- Monitor existing signals normally")[0]
        .replace("begin;", ""),
    );
    const now = Date.now();
    for (const buy of [true, false])
      for (const choch of [false, true]) {
        const s = mt5SnapshotSchema.parse(baseSnapshot(buy, choch, now)),
          p = scanBaseRetests(s, now)[0];
        assert.ok(p);
        const valid = async (plan: unknown, snapshot: unknown = s) =>
          (
            await db.query<{ v: boolean }>(
              "select public.valid_base_retest_plan($1,$2) v",
              [JSON.stringify(snapshot), JSON.stringify(plan)],
            )
          ).rows[0].v;
        assert.equal(await valid(p), true, `${buy} ${choch}`);
        assert.equal(await valid({ ...p, stop: p.stop + 3 }), false);
        assert.equal(
          await valid({ ...p, base: { ...p.base, start: 0 } }),
          false,
        );
        assert.equal(
          await valid({ ...p, method: choch ? "BOS" : "CHOCH" }),
          false,
        );
        const weak = structuredClone(s);
        weak.series[0].candles.at(-1)!.close =
          weak.series[0].candles.at(-1)!.open;
        assert.equal(await valid(p, weak), false);
      }
  } finally {
    await db.close();
  }
});
