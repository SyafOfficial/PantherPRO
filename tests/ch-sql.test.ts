import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { chSnapshot } from "./helpers/ch-fixture";
import { scanCh } from "../lib/engine/ch";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
test("CH SQL independently validates cup, handle, breakout, rejection and stop for both directions", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role;",
    );
    for (const path of [
      "20261106172019_hns_break_retest_strategy.sql",
      "20261106175442_ch_break_retest_strategy.sql",
    ])
      await db.exec(
        (await readFile("supabase/migrations/" + path, "utf8"))
          .split("alter table public.signals")[0]
          .replace("begin;", ""),
      );
    const now = Date.now();
    for (const buy of [true, false])
      for (const slope of [0, 0.04]) {
        const s = mt5SnapshotSchema.parse(chSnapshot(buy, slope, now)),
          p = scanCh(s, now)[0];
        assert.ok(p);
        const valid = async (plan: unknown, snapshot: unknown = s) =>
          (
            await db.query<{ v: boolean }>(
              "select public.valid_ch_plan($1,$2) v",
              [JSON.stringify(snapshot), JSON.stringify(plan)],
            )
          ).rows[0].v;
        assert.equal(await valid(p), true, `${buy} ${slope}`);
        assert.equal(await valid({ ...p, stop: p.stop + 1 }), false);
        assert.equal(await valid({ ...p, timeframe: "W1" }), false);
        assert.equal(
          await valid({
            ...p,
            ch: { ...p.ch, anchors: [0, ...p.ch.anchors.slice(1)] },
          }),
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
