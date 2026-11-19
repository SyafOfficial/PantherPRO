import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { baseSnapshot } from "./helpers/base-fixture";
import { scanBaseRetests } from "../lib/engine/base-retest";
import { mt5SnapshotSchema } from "../lib/engine/mt5";
const admin = "00000000-0000-4000-8000-000000000001";
async function database() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',nullif(current_setting('request.jwt.claim.aal',true),''))$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;create publication supabase_realtime;create schema cron;create function cron.schedule(text,text,text)returns bigint language sql as $$select 1::bigint$$;`,
  );
  for (const f of (await readdir("supabase/migrations")).sort())
    await db.exec(
      (await readFile("supabase/migrations/" + f, "utf8")).replace(
        "create extension if not exists pg_cron with schema pg_catalog;",
        "",
      ),
    );
  await db.query("insert into auth.users(id)values($1)", [admin]);
  await db.query("update public.profiles set role='admin' where id=$1", [
    admin,
  ]);
  await db.query(
    "update public.automatic_engine_policy set enabled=true,approved_by=$1,base_entry_mode='base-waiting-v1'",
    [admin],
  );
  return db;
}
async function service(db: PGlite) {
  await db.exec("reset role");
  await db.exec(
    "select set_config('request.jwt.claim.role','service_role',false);set role service_role;",
  );
}
test("waiting setups publish once, activate on a later zone return and never track outcomes before entry", async () => {
  const db = await database();
  try {
    for (const buy of [true, false])
      for (const scenario of [
        "activate",
        "gap",
        "invalidated",
        "expired",
        "target",
        "paused",
      ]) {
        await db.exec("reset role;begin");
        await service(db);
        const now = Date.now() - 12000,
          s = mt5SnapshotSchema.parse(baseSnapshot(buy, false, now));
        const original = scanBaseRetests(s, now)[0];
        assert.ok(original);
        s.quote.bid = buy ? 71.5 : 228.3;
        s.quote.ask = s.quote.bid + 0.1;
        const plan = scanBaseRetests(s, now, {}, true)[0];
        assert.equal(plan?.entryState, "waiting");
        const ingest = async (snapshot: unknown, at: string, key = "a") =>
          db.query("select public.ingest_mt5_snapshot($1,$2,$3)", [
            JSON.stringify(snapshot),
            key.repeat(64),
            at,
          ]);
        const at = new Date(Math.floor(now / 1000) * 1000).toISOString();
        await ingest(s, at);
        const apply = async (at: string, plans: unknown[] = []) =>
          (
            await db.query<{ r: any }>(
              "select public.apply_automatic_engine($1,$2)r",
              [at, JSON.stringify(plans)],
            )
          ).rows[0].r;
        assert.equal((await apply(at, [plan])).waiting, 1);
        assert.equal((await apply(at, [plan])).waiting, 0);
        await db.exec("reset role");
        let row = (
          await db.query<any>("select * from public.signals where source='mt5'")
        ).rows[0];
        assert.equal(row.status, "pending");
        assert.equal(row.entry_phase, "waiting");
        assert.equal(Number(row.stop_loss), original.stop);
        assert.equal(
          (
            await db.query<any>(
              "select count(*)::int n from public.automatic_engine_tracking",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query<any>(
              "select count(*)::int n from public.signal_performance_ledger",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query<any>(
              "select count(*)::int n from public.notification_outbox where event_type='signal.waiting'",
            )
          ).rows[0].n,
          1,
        );
        if (scenario === "gap")
          await db.query(
            "update public.automatic_entry_waits set last_snapshot=last_snapshot-interval '2 minutes'",
          );
        if (scenario === "paused")
          await db.exec(
            "update public.automatic_engine_policy set enabled=false",
          );
        if (scenario === "expired")
          await db.query(
            "update public.automatic_entry_waits set expires_broker=$1",
            [s.server_time_raw],
          );
        const next = structuredClone(s);
        next.server_time_raw += 1;
        next.quote = {
          ...next.quote,
          bid: original.entry - (buy ? 0.1 : 0),
          ask: original.entry + (buy ? 0 : 0.1),
          last_tick_time_raw: next.server_time_raw,
          last_tick_time_msc_raw: next.server_time_raw * 1000,
        };
        const at2 = new Date(Date.parse(at) + 1000).toISOString();
        next.exported_at_utc = at2
          .slice(0, 19)
          .replace(/-/g, ".")
          .replace("T", " ");
        if (scenario === "target") {
          next.quote.bid = buy ? plan.targets[0] + 1 : plan.targets[0] - 0.1;
          next.quote.ask = next.quote.bid + 0.1;
        }
        if (scenario === "invalidated") {
          const c = structuredClone(next.series[0].candles.at(-1)!);
          c.opened_at_server_raw += 300;
          c.close = buy ? plan.stop - 1 : plan.stop + 1;
          c.high = Math.max(c.open, c.close) + 1;
          c.low = Math.min(c.open, c.close) - 1;
          next.server_time_raw = c.opened_at_server_raw + 300;
          next.quote.last_tick_time_raw = next.server_time_raw;
          next.quote.last_tick_time_msc_raw = next.server_time_raw * 1000;
          if (buy) next.series[0].candles.push(c);
          else next.ask_m5!.push(c);
        }
        await service(db);
        await ingest(next, at2, "b");
        const result = await apply(at2);
        await db.exec("reset role");
        row = (
          await db.query<any>("select * from public.signals where source='mt5'")
        ).rows[0];
        if (scenario === "activate") {
          assert.equal(
            row.entry_phase,
            "entered",
            JSON.stringify({
              result,
              reason: row.entry_wait_reason,
              buy,
              scenario,
            }),
          );
          assert.equal(row.status, "active");
          assert.equal(row.entry_phase, "entered");
          assert.ok(Math.abs(Number(row.entry) - original.entry) < 1e-8);
          assert.equal(
            (
              await db.query<any>(
                "select count(*)::int n from public.automatic_engine_tracking",
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await db.query<any>(
                "select count(*)::int n from public.signal_performance_ledger",
              )
            ).rows[0].n,
            1,
          );
          await service(db);
          assert.equal((await apply(at2)).activated, 0);
        } else {
          assert.equal(row.entry_phase, "cancelled", scenario);
          assert.equal(row.entry_phase, "cancelled");
          assert.equal(row.status, "closed");
          assert.equal(row.stop_observed_at, null);
          assert.equal(row.tp1_hit_at, null);
          assert.equal(
            (
              await db.query<any>(
                "select count(*)::int n from public.signal_performance_ledger",
              )
            ).rows[0].n,
            0,
          );
        }
        await db.exec("reset role;rollback");
      }
  } finally {
    await db.close();
  }
});

test("waiting mode is opt-in and never permits a wick-only or stale confirmation", () => {
  const now = Date.now(),
    s = mt5SnapshotSchema.parse(baseSnapshot(true, false, now));
  s.quote.bid = 71.5;
  s.quote.ask = 71.6;
  assert.equal(scanBaseRetests(s, now).length, 0);
  assert.equal(scanBaseRetests(s, now + 31_000, {}, true).length, 0);
  assert.equal(scanBaseRetests(s, now, {}, true)[0]?.entryState, "waiting");
  s.series[0].candles.at(-1)!.close = s.series[0].candles.at(-1)!.open;
  assert.equal(scanBaseRetests(s, now, {}, true).length, 0);
});
