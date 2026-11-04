import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  public: "00000000-0000-4000-8000-000000000002",
  vip: "00000000-0000-4000-8000-000000000003",
};
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal',nullif(current_setting('request.jwt.claim.aal',true),'')) $$;
 create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;
 create publication supabase_realtime;`);
  // PGlite has no pg_cron worker; emulate only the scheduler registration API.
  // Production pg_cron installation and job state are verified against Supabase.
  await db.exec(
    "create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;",
  );
  for (const file of (await readdir("supabase/migrations")).sort()) {
    const sql = await readFile(`supabase/migrations/${file}`, "utf8");
    await db.exec(
      sql.replace(
        "create extension if not exists pg_cron with schema pg_catalog;",
        "",
      ),
    );
  }
  await db.query(
    "insert into auth.users(id) values ($1),($2),($3)",
    Object.values(ids),
  );
  await db.query("update public.profiles set role='admin' where id=$1", [
    ids.admin,
  ]);
  await db.query("update public.profiles set role='vip' where id=$1", [
    ids.vip,
  ]);
  return db;
}
async function as(
  db: PGlite,
  role: "admin" | "public" | "vip" | "service_role" | "anon",
) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
    [
      role in ids ? ids[role as keyof typeof ids] : "",
      role === "service_role"
        ? "service_role"
        : role === "anon"
          ? "anon"
          : "authenticated",
    ],
  );
  await db.query("select set_config('request.jwt.claim.aal',$1,false)", [
    role === "admin" ? "aal2" : "aal1",
  ]);
  await db.exec(
    `set role ${role === "service_role" ? "service_role" : role === "anon" ? "anon" : "authenticated"}`,
  );
}
test("retention deletes only old closed signals and dependents, keeps active/recent and prevents republishing", async () => {
  const db = await setup();
  try {
    await as(db, "service_role");
    const alert = {
      event_id: "retention-test-event",
      timestamp: new Date().toISOString(),
      instrument: "XAUUSD",
      direction: "BUY",
      entry: 100,
      stop_loss: 96,
      tp1: 105,
      tp2: 110,
      tp3: 120,
      reasoning: "Retention fixture with an independently approved lifecycle.",
      access: "public",
      strategy: "BOS",
      timeframe: "M15",
      higher_timeframe: "M30",
    };
    const old = (
      await db.query<{ result: { id: string } }>(
        "select ingest_tradingview($1,$2) result",
        [alert, "a".repeat(64)],
      )
    ).rows[0].result.id;
    await as(db, "admin");
    await db.query("select transition_signal($1,'active')", [old]);
    await db.query("select transition_signal($1,'closed')", [old]);
    const create = async (status: string, days: number) => {
      const id = (
        await db.query<{ id: string }>(
          "insert into signals(direction,entry,stop_loss,tp1,tp2,tp3,reasoning) values('BUY',100,96,105,110,120,'Protected retention fixture for active and recent signals.') returning id",
        )
      ).rows[0].id;
      await db.query("select transition_signal($1,'pending')", [id]);
      if (status !== "pending")
        await db.query("select transition_signal($1,'active')", [id]);
      if (status === "closed")
        await db.query("select transition_signal($1,'closed')", [id]);
      await db.exec("reset role");
      await db.query(
        "update signals set closed_at=case when status='closed' then now()-make_interval(days=>$2) else null end,created_at=now()-make_interval(days=>$2) where id=$1",
        [id, days],
      );
      await as(db, "admin");
      return id;
    };
    const active = await create("active", 60),
      recent = await create("closed", 29),
      pending = await create("pending", 60),
      boundary = await create("closed", 30);
    await db.exec("reset role");
    // Set the cutoff boundary in the same transaction as cleanup so exact 30 days is retained.
    await db.exec("begin");
    await db.query(
      "update signals set closed_at=now()-interval '31 days' where id=$1",
      [old],
    );
    await db.query(
      "update signals set closed_at=now()-interval '30 days' where id=$1",
      [boundary],
    );
    await db.query(
      "insert into automatic_engine_tracking(signal_id,last_snapshot,last_m5_open,state) values($1,now(),1,'closed')",
      [old],
    );
    const out = (
      await db.query<{ id: string }>(
        "insert into notification_outbox(event_key,signal_id,event_type,access) values('retention-outbox',$1,'signal.closed','public') returning id",
        [old],
      )
    ).rows[0].id;
    const device = (
      await db.query<{ id: string }>(
        "insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/retention-fixture','key','auth') returning id",
        [ids.public],
      )
    ).rows[0].id;
    await db.query(
      "insert into notification_deliveries(outbox_id,subscription_id,state) values($1,$2,'delivered')",
      [out, device],
    );
    const result = (
      await db.query<{ result: { deleted_signals: number } }>(
        "select cleanup_closed_signals_30_days() result",
      )
    ).rows[0].result;
    assert.equal(result.deleted_signals, 1);
    assert.equal(
      (await db.query("select * from signals where id=$1", [old])).rows.length,
      0,
    );
    for (const id of [active, recent, pending, boundary])
      assert.equal(
        (await db.query("select * from signals where id=$1", [id])).rows.length,
        1,
      );
    assert.equal(
      (
        await db.query("select * from notification_outbox where signal_id=$1", [
          old,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from notification_deliveries where outbox_id=$1",
          [out],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from automatic_engine_tracking where signal_id=$1",
          [old],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from retired_signal_keys where signal_id=$1", [
          old,
        ])
      ).rows.length,
      1,
    );
    assert.ok(
      (await db.query("select * from audit_logs where entity_id=$1", [old]))
        .rows.length > 0,
    );
    assert.equal(
      (
        await db.query<{ r: { deleted_signals: number } }>(
          "select cleanup_closed_signals_30_days() r",
        )
      ).rows[0].r.deleted_signals,
      0,
    );
    await db.exec("commit");
    await as(db, "service_role");
    const replay = (
      await db.query<{ r: { id: string; duplicate: boolean } }>(
        "select ingest_tradingview($1,$2) r",
        [alert, "a".repeat(64)],
      )
    ).rows[0].r;
    assert.equal(replay.id, old);
    assert.equal(replay.duplicate, true);
    await assert.rejects(
      db.query("select ingest_tradingview($1,$2)", [alert, "b".repeat(64)]),
      /Conflicting retired event/,
    );
    for (const role of [
      "anon",
      "public",
      "vip",
      "admin",
      "service_role",
    ] as const) {
      await as(db, role);
      await assert.rejects(
        db.query("select cleanup_closed_signals_30_days()"),
        /permission denied/,
      );
    }
  } finally {
    await db.close();
  }
});
