import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { roleReversalSnapshot } from "./helpers/role-reversal-fixture";
import { scanRoleReversals } from "../lib/engine/role-reversal";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
test("SQL recomputes last pre-break touch, completed pivot, horizontal retest and strict structural stop independently", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role;",
    );
    for (const [path, marker] of [
      [
        "20261106172019_hns_break_retest_strategy.sql",
        "alter table public.signals",
      ],
      [
        "20261112065059_structure_base_retest_wick_stop.sql",
        "-- Monitor existing signals normally",
      ],
      [
        "20261113110452_sbr_rbs_last_touch_stops.sql",
        "-- Additive methods only",
      ],
    ])
      await db.exec(
        (await readFile(`supabase/migrations/${path}`, "utf8"))
          .split(marker)[0]
          .replace("begin;", ""),
      );
    const now = Date.now();
    for (const buy of [true, false]) {
      const s = mt5SnapshotSchema.parse(roleReversalSnapshot(buy, now)),
        p = scanRoleReversals(s, now).plans[0];
      const valid = async (plan: unknown, snapshot: unknown = s) =>
        (
          await db.query<{ v: boolean }>(
            "select public.valid_role_reversal_plan($1,$2) v",
            [JSON.stringify(snapshot), JSON.stringify(plan)],
          )
        ).rows[0].v;
      assert.equal(await valid(p), true, String(buy));
      for (const stop of [
        buy ? 65 : 235,
        buy ? 59.99 : 240.01,
        buy ? p.zoneLow - 3 : p.zoneHigh + 3,
        p.entry,
      ])
        assert.equal(await valid({ ...p, stop }), false);
      assert.equal(await valid({ ...p, sourceEventId: "a".repeat(64) }), false);
      assert.equal(await valid({ ...p, method: buy ? "SBR" : "RBS" }), false);
      assert.equal(
        await valid({
          ...p,
          roleReversal: {
            ...p.roleReversal,
            reference: s.series[1].candles.at(-1),
          },
        }),
        false,
      );
      assert.equal(
        await valid({
          ...p,
          roleReversal: {
            ...p.roleReversal,
            reference: {
              ...p.roleReversal.reference,
              opened_at_server_raw: p.confirmationOpenedServer,
            },
          },
        }),
        false,
      );
      assert.equal(
        await valid({
          ...p,
          roleReversal: {
            ...p.roleReversal,
            reference: {
              ...p.roleReversal.reference,
              opened_at_server_raw:
                s.series[1].candles[25].opened_at_server_raw,
            },
          },
        }),
        false,
      );
      const wick = structuredClone(s);
      wick.series[1].candles.at(-1)!.close = buy ? 72 : 228;
      assert.equal(await valid(p, wick), false);
      const stale = structuredClone(s);
      stale.server_time_raw += 301;
      assert.equal(await valid(p, stale), false);
      const weak = structuredClone(s);
      weak.series[0].candles.at(-1)!.close =
        weak.series[0].candles.at(-1)!.open;
      assert.equal(await valid(p, weak), false);
      const future = structuredClone(s);
      future.series[1].candles.at(-1)!.opened_at_server_raw =
        future.server_time_raw - 800;
      assert.equal(await valid(p, future), false);
    }
  } finally {
    await db.close();
  }
});
