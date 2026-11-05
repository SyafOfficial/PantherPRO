import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  public: "00000000-0000-4000-8000-000000000002",
  member: "00000000-0000-4000-8000-000000000003",
};
async function setup(skipRecentDesk = false) {
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
    if (skipRecentDesk && file.endsWith("_client_recent_signal_desk.sql"))
      continue;
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
  await db.query("update public.profiles set role='public' where id=$1", [
    ids.member,
  ]);
  return db;
}
async function as(
  db: PGlite,
  role: "admin" | "public" | "member" | "service_role" | "anon",
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
async function draft(db: PGlite, access = "public") {
  const r = await db.query<{ id: string }>(
    `insert into public.signals(direction,entry,stop_loss,tp1,tp2,tp3,reasoning,access) values ('BUY',2000,1990,2010,2020,2030,'A staging-only support retest with defined risk.',$1) returning id`,
    [access],
  );
  return r.rows[0].id;
}
const change = {
  instrument: "XAUUSD",
  direction: "BUY",
  entry: 2000,
  stop_loss: 1991,
  tp1: 2010,
  tp2: 2020,
  tp3: 2030,
  reasoning: "An administrator-reviewed staging revision with a tighter stop.",
  access: "public",
};
test("migrations enforce RLS, review, immutable roles and audited optimistic revisions", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    const id = await draft(db, "public");
    await assert.rejects(
      db.query("select public.transition_signal($1,'active')", [id]),
      /Invalid lifecycle/,
    );
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("update public.profiles set role='admin' where id=$1", [
        ids.public,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.transition_signal($1,'active')", [id]),
      /Administrator required/,
    );
    await assert.rejects(draft(db), /Administrator|row-level security/);
    await as(db, "admin");
    await db.query("select public.transition_signal($1,'active')", [id]);
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      1,
    );
    await as(db, "member");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("delete from public.audit_logs"),
      /permission denied/,
    );
    await as(db, "admin");
    await db.query("select public.revise_signal($1,3,$2,$3)", [
      id,
      JSON.stringify(change),
      "Tighter stop after manual review",
    ]);
    await assert.rejects(
      db.query("select public.revise_signal($1,3,$2,$3)", [
        id,
        JSON.stringify(change),
        "A concurrent stale revision",
      ]),
      /Stale revision/,
    );
    await assert.rejects(
      db.query("select public.revise_signal($1,4,$2,$3)", [
        id,
        JSON.stringify({ ...change, entry: 2001 }),
        "Attempt to change a published entry",
      ]),
      /Published entry/,
    );
    const events = await db.query("select * from public.notification_outbox");
    assert.equal(events.rows.length, 2);
    await db.query("select public.transition_signal($1,'closed')", [id]);
    await assert.rejects(
      db.query("select public.transition_signal($1,'active')", [id]),
      /Invalid lifecycle/,
    );
    await as(db, "anon");
    await assert.rejects(
      db.query("select * from public.signals"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("webhook ingestion is service-only, idempotent, conflict-aware and stays unpublished", async () => {
  const db = await setup();
  try {
    const payload = {
      ...change,
      access: "public",
      event_id: "test-alert-0001",
      timestamp: new Date().toISOString(),
    };
    await as(db, "public");
    await assert.rejects(
      db.query("select public.ingest_tradingview($1,$2)", [
        JSON.stringify(payload),
        "a".repeat(64),
      ]),
      /permission denied/,
    );
    await as(db, "service_role");
    const first = await db.query<{
      result: { id: string; duplicate: boolean; status: string };
    }>("select public.ingest_tradingview($1,$2) as result", [
      JSON.stringify(payload),
      "a".repeat(64),
    ]);
    assert.equal(first.rows[0].result.status, "pending");
    assert.equal(first.rows[0].result.duplicate, false);
    const replay = await db.query<{ result: { duplicate: boolean } }>(
      "select public.ingest_tradingview($1,$2) as result",
      [JSON.stringify(payload), "a".repeat(64)],
    );
    assert.equal(replay.rows[0].result.duplicate, true);
    await assert.rejects(
      db.query("select public.ingest_tradingview($1,$2)", [
        JSON.stringify(payload),
        "b".repeat(64),
      ]),
      /Conflicting event/,
    );
    await assert.rejects(
      db.query("select public.ingest_tradingview($1,$2)", [
        JSON.stringify({ ...payload, timestamp: "2000-01-01T00:00:00Z" }),
        "a".repeat(64),
      ]),
      /Stale alert/,
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      0,
    );
    await as(db, "admin");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.notification_outbox")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("push fanout respects member preferences, preferences, lease tokens, retries and revocation", async () => {
  const db = await setup();
  try {
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    await as(db, "member");
    await db.query("select public.register_push_subscription($1)", [
      JSON.stringify(sub),
    ]);
    await as(db, "public");
    await assert.rejects(
      db.query("select public.register_push_subscription($1)", [
        JSON.stringify(sub),
      ]),
      /Subscription unavailable/,
    );
    await as(db, "admin");
    const id = await draft(db, "public");
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await db.query("select public.transition_signal($1,'active')", [id]);
    await as(db, "service_role");
    await db.query("select public.prepare_push_deliveries()");
    await db.query("select public.prepare_push_deliveries()");
    type Claim = { id: string; lease_token: string };
    const claimed = await db.query<{ jobs: Claim[] }>(
      "select public.claim_push_deliveries() as jobs",
    );
    assert.equal(claimed.rows[0].jobs.length, 1);
    assert.equal(
      (
        await db.query<{ jobs: Claim[] }>(
          "select public.claim_push_deliveries() as jobs",
        )
      ).rows[0].jobs.length,
      0,
    );
    const item = claimed.rows[0].jobs[0];
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select public.finish_push_delivery($1,$2,'delivered') as ok",
          [item.id, ids.public],
        )
      ).rows[0].ok,
      false,
    );
    await db.query(
      "select public.finish_push_delivery($1,$2,'retry','http_503')",
      [item.id, item.lease_token],
    );
    assert.equal(
      (
        await db.query<{ jobs: Claim[] }>(
          "select public.claim_push_deliveries() as jobs",
        )
      ).rows[0].jobs.length,
      0,
    );
    await as(db, "member");
    await db.query(
      "update public.notification_preferences set push_enabled=false where user_id=$1",
      [ids.member],
    );
    await db.exec("reset role");
    await db.exec(
      "update public.notification_deliveries set next_attempt_at=now()-interval '1 minute'",
    );
    await as(db, "service_role");
    assert.equal(
      (
        await db.query<{ jobs: Claim[] }>(
          "select public.claim_push_deliveries() as jobs",
        )
      ).rows[0].jobs.length,
      0,
    );
    await db.query("select public.finalize_push_events()");
    await db.exec("reset role");
    const rows = await db.query<{ state: string }>(
      "select state from public.notification_deliveries",
    );
    assert.equal(rows.rows[0].state, "skipped");
  } finally {
    await db.close();
  }
});
test("push completion is idempotent and expired devices retain delivery history", async () => {
  const db = await setup();
  try {
    const sub = {
      endpoint: "https://web.push.apple.com/test-device",
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    await as(db, "public");
    await db.query("select public.register_push_subscription($1)", [
      JSON.stringify(sub),
    ]);
    const queued = await db.query<{ id: string }>(
      "select public.enqueue_test_notification() as id",
    );
    assert.ok(queued.rows[0].id);
    await assert.rejects(
      db.query("select public.enqueue_test_notification()"),
      /Test rate exceeded/,
    );
    await as(db, "service_role");
    await db.query("select public.prepare_push_deliveries()");
    const first = await db.query<{
      jobs: { id: string; lease_token: string }[];
    }>("select public.claim_push_deliveries() as jobs");
    const job = first.rows[0].jobs[0];
    assert.ok(job);
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select public.finish_push_delivery($1,$2,'delivered') as ok",
          [job.id, job.lease_token],
        )
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select public.finish_push_delivery($1,$2,'delivered') as ok",
          [job.id, job.lease_token],
        )
      ).rows[0].ok,
      false,
    );
    await db.query("select public.finalize_push_events()");
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from public.notification_outbox",
        )
      ).rows[0].state,
      "delivered",
    );
    // Allow another self-test without waiting a minute, using only the test database owner.
    await db.exec(
      "update public.notification_outbox set created_at=now()-interval '2 minutes'",
    );
    await as(db, "public");
    await db.query("select public.enqueue_test_notification()");
    await as(db, "service_role");
    await db.query("select public.prepare_push_deliveries()");
    const expired = (
      await db.query<{ jobs: { id: string; lease_token: string }[] }>(
        "select public.claim_push_deliveries() as jobs",
      )
    ).rows[0].jobs[0];
    await db.query(
      "select public.finish_push_delivery($1,$2,'expired','http_410')",
      [expired.id, expired.lease_token],
    );
    await db.query("select public.finalize_push_events()");
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ active: boolean }>(
          "select active from public.push_subscriptions",
        )
      ).rows[0].active,
      false,
    );
    assert.equal(
      (await db.query("select * from public.notification_deliveries")).rows
        .length,
      2,
    );
  } finally {
    await db.close();
  }
});
test("announcements preserve member visibility and fanout honors preference categories", async () => {
  const db = await setup();
  try {
    const sub = {
      endpoint: "https://fcm.googleapis.com/device-public",
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    await as(db, "public");
    await db.query("select public.register_push_subscription($1)", [
      JSON.stringify(sub),
    ]);
    await db.query(
      "update public.notification_preferences set announcements=false where user_id=$1",
      [ids.public],
    );
    await assert.rejects(
      db.query("select public.publish_announcement('Title','Body','public')"),
      /Administrator required/,
    );
    await as(db, "admin");
    await db.query(
      "select public.publish_announcement('Public update','A public staging announcement.','public')",
    );
    await db.query(
      "select public.publish_announcement('Member update','A member staging announcement.','public')",
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.announcements")).rows.length,
      2,
    );
    await as(db, "member");
    assert.equal(
      (await db.query("select * from public.announcements")).rows.length,
      2,
    );
    await as(db, "service_role");
    await db.query("select public.prepare_push_deliveries()");
    assert.equal(
      (
        await db.query<{ jobs: unknown[] }>(
          "select public.claim_push_deliveries() as jobs",
        )
      ).rows[0].jobs.length,
      0,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from public.notification_deliveries")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

async function provider(
  db: PGlite,
  kind: "quotes" | "calendar",
  options: { display?: boolean; gap?: number; enabled?: boolean } = {},
) {
  await db.exec("reset role");
  const r = await db.query<{ id: string }>(
    "insert into public.data_providers(display_name,kind,license_reference,enabled,display_allowed,reconciliation_allowed,max_gap_seconds) values ('LOCAL TEST FIXTURE',$1,'Test-only authorization reference, no real market data',$2,$3,true,$4) returning id",
    [kind, options.enabled ?? true, options.display ?? true, options.gap ?? 60],
  );
  return r.rows[0].id;
}
async function quote(
  db: PGlite,
  provider_id: string,
  reference: string,
  bid: number,
  ask: number,
  observed_at: string,
) {
  const r = await db.query<{ result: { id: string; duplicate: boolean } }>(
    "select public.ingest_market_quote($1) as result",
    [
      JSON.stringify({
        provider_id,
        reference,
        instrument: "XAUUSD",
        bid,
        ask,
        observed_at,
      }),
    ],
  );
  return r.rows[0].result;
}
test("licensed quotes reject stale/conflicting data and honor source display permissions", async () => {
  const db = await setup();
  try {
    const source = await provider(db, "quotes", { display: false });
    const time = new Date().toISOString();
    await as(db, "public");
    await assert.rejects(
      quote(db, source, "quote-001", 1999, 2000, time),
      /permission denied/,
    );
    await as(db, "service_role");
    const first = await quote(db, source, "quote-001", 1999, 2000, time);
    assert.equal(first.duplicate, false);
    assert.equal(
      (await quote(db, source, "quote-001", 1999, 2000, time)).duplicate,
      true,
    );
    await assert.rejects(
      quote(db, source, "quote-001", 1998, 2000, time),
      /Conflicting quote/,
    );
    await assert.rejects(
      quote(db, source, "quote-stale", 1999, 2000, "2000-01-01T00:00:00Z"),
      /freshness/,
    );
    await assert.rejects(
      quote(
        db,
        source,
        "quote-old",
        1999,
        2000,
        new Date(Date.parse(time) - 1000).toISOString(),
      ),
      /Out-of-order/,
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.market_quotes")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ data: { quote: unknown } }>(
          "select public.get_market_snapshot() as data",
        )
      ).rows[0].data.quote,
      null,
    );
    await assert.rejects(
      db.query("update public.data_providers set display_allowed=true"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "update public.data_providers set display_allowed=true where id=$1",
      [source],
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.market_quotes")).rows.length,
      1,
    );
    await db.exec("reset role");
    await db.query(
      "update public.data_providers set enabled=false where id=$1",
      [source],
    );
    await as(db, "service_role");
    await assert.rejects(
      quote(db, source, "disabled", 1999, 2000, new Date().toISOString()),
      /Enabled licensed/,
    );
  } finally {
    await db.close();
  }
});
test("BUY quote observation uses bid exits, records targets once and stops after a stop touch", async () => {
  const db = await setup();
  try {
    const source = await provider(db, "quotes");
    await as(db, "admin");
    const id = await draft(db);
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await db.query("select public.transition_signal($1,'active')", [id]);
    const base = Date.now();
    const time = (offset: number) => new Date(base + offset).toISOString();
    await as(db, "service_role");
    const first = await quote(db, source, "baseline", 1998, 1999, time(500));
    await as(db, "public");
    await assert.rejects(
      db.query("select public.start_signal_observation($1,$2)", [id, first.id]),
      /Administrator required/,
    );
    await as(db, "admin");
    await db.query("select public.start_signal_observation($1,$2)", [
      id,
      first.id,
    ]);
    await as(db, "service_role");
    await quote(db, source, "tp1", 2011, 2012, time(1000));
    await quote(db, source, "tp2", 2021, 2022, time(1500));
    await quote(db, source, "stop", 1989, 1990, time(2000));
    await quote(db, source, "late-rally", 2040, 2041, time(2500));
    await as(db, "admin");
    const s = (
      await db.query<{
        tp1_hit_at: string | null;
        tp2_hit_at: string | null;
        tp3_hit_at: string | null;
        outcome: string | null;
        status: string;
        reconciliation_state: string;
        max_favorable_movement: string;
        version: number;
      }>("select * from public.signals where id=$1", [id])
    ).rows[0];
    assert.ok(s.tp1_hit_at);
    assert.ok(s.tp2_hit_at);
    assert.equal(s.tp3_hit_at, null);
    assert.equal(s.reconciliation_state, "stopped");
    assert.equal(Number(s.max_favorable_movement), 22);
    assert.equal(s.outcome, null);
    assert.equal(s.status, "active");
    const events = await db.query<{ event_type: string }>(
      "select event_type from public.notification_outbox",
    );
    assert.deepEqual(events.rows.map((r) => r.event_type).sort(), [
      "signal.active",
      "signal.stop_hit",
      "signal.tp1",
      "signal.tp2",
    ]);
    await assert.rejects(
      db.query("select public.revise_signal($1,$2,$3,$4)", [
        id,
        s.version,
        JSON.stringify({ ...change, access: "public", tp1: 2012 }),
        "Attempt to overwrite an observed target",
      ]),
      /Observed target/,
    );
  } finally {
    await db.close();
  }
});
test("SELL observations use ask exits and feed gaps halt evaluation rather than guess touches", async () => {
  const db = await setup();
  try {
    const source = await provider(db, "quotes", { gap: 1 });
    await as(db, "admin");
    const id = (
      await db.query<{ id: string }>(
        "insert into public.signals(direction,entry,stop_loss,tp1,tp2,tp3,reasoning) values ('SELL',2000,2010,1990,1980,1970,'A fictional SELL fixture for quote-side testing.') returning id",
      )
    ).rows[0].id;
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await db.query("select public.transition_signal($1,'active')", [id]);
    const base = Date.now();
    const time = (offset: number) => new Date(base + offset).toISOString();
    await as(db, "service_role");
    const first = await quote(
      db,
      source,
      "sell-baseline",
      2001,
      2002,
      time(200),
    );
    await as(db, "admin");
    await db.query("select public.start_signal_observation($1,$2)", [
      id,
      first.id,
    ]);
    await as(db, "service_role");
    await quote(db, source, "bid-only-touch", 1989, 1991, time(700));
    await as(db, "admin");
    assert.equal(
      (
        await db.query<{ tp1_hit_at: unknown }>(
          "select tp1_hit_at from public.signals where id=$1",
          [id],
        )
      ).rows[0].tp1_hit_at,
      null,
    );
    await as(db, "service_role");
    await quote(db, source, "ask-touch", 1989, 1990, time(1000));
    await quote(db, source, "gap", 1969, 1970, time(3000));
    await as(db, "admin");
    const signal = (
      await db.query<{
        tp1_hit_at: unknown;
        tp2_hit_at: unknown;
        reconciliation_state: string;
      }>("select * from public.signals where id=$1", [id])
    ).rows[0];
    assert.ok(signal.tp1_hit_at);
    assert.equal(signal.tp2_hit_at, null);
    assert.equal(signal.reconciliation_state, "gap");
  } finally {
    await db.close();
  }
});
test("calendar preserves revisions, missing values and licensed visibility without duplicate news", async () => {
  const db = await setup();
  try {
    const source = await provider(db, "calendar");
    const base = Date.now();
    const upcoming = {
      provider_id: source,
      reference: "fixture-cpi",
      name: "FICTIONAL TEST CPI",
      country: "United States",
      currency: "USD",
      event_time: new Date(base + 15 * 60000).toISOString(),
      previous: null,
      forecast: null,
      actual: null,
      importance: "high",
      source_updated_at: new Date(base).toISOString(),
      source_url: "https://example.test/fixture-only",
    };
    const ingest = (data: unknown) =>
      db.query<{ result: { id: string; duplicate: boolean } }>(
        "select public.ingest_calendar_event($1) as result",
        [JSON.stringify(data)],
      );
    await as(db, "service_role");
    const first = (await ingest(upcoming)).rows[0].result;
    assert.equal(first.duplicate, false);
    assert.equal((await ingest(upcoming)).rows[0].result.duplicate, true);
    await assert.rejects(
      ingest({
        ...upcoming,
        name: "Conflicting data, same revision timestamp",
      }),
      /Conflicting calendar/,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select public.queue_upcoming_calendar_events() as count",
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select public.queue_upcoming_calendar_events() as count",
        )
      ).rows[0].count,
      0,
    );
    await assert.rejects(
      ingest({
        ...upcoming,
        actual: "2.1%",
        source_updated_at: new Date(base + 1000).toISOString(),
      }),
      /Actual figure cannot precede/,
    );
    const released = {
      ...upcoming,
      event_time: new Date(base - 1000).toISOString(),
      actual: "2.1%",
      source_updated_at: new Date(base + 1000).toISOString(),
    };
    await ingest(released);
    await ingest({
      ...released,
      actual: "2.2%",
      source_updated_at: new Date(base + 2000).toISOString(),
    });
    await assert.rejects(ingest(upcoming), /Stale calendar/);
    await as(db, "public");
    const event = (
      await db.query<{
        previous: unknown;
        forecast: unknown;
        actual: string;
        version: number;
      }>("select * from public.calendar_events")
    ).rows[0];
    assert.equal(event.previous, null);
    assert.equal(event.forecast, null);
    assert.equal(event.actual, "2.2%");
    assert.equal(event.version, 3);
    assert.equal(
      (await db.query("select * from public.calendar_event_revisions")).rows
        .length,
      0,
    );
    await as(db, "admin");
    assert.equal(
      (await db.query("select * from public.calendar_event_revisions")).rows
        .length,
      3,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.notification_outbox where event_type='news.released'",
        )
      ).rows.length,
      1,
    );
    await db.exec("reset role");
    await db.query(
      "update public.data_providers set display_allowed=false where id=$1",
      [source],
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.calendar_events")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ data: { events: unknown[] } }>(
          "select public.get_market_snapshot() as data",
        )
      ).rows[0].data.events.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("source observations cannot be forged on draft insert and NaN prices fail database checks", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    await assert.rejects(
      db.query(
        "insert into public.signals(direction,entry,stop_loss,tp1,tp2,tp3,reasoning,reconciliation_state) values ('BUY',2000,1990,2010,2020,2030,'A test-only attempt to forge source observation.','observing')",
      ),
      /unapproved drafts/,
    );
    await assert.rejects(
      db.query(
        "insert into public.signals(direction,entry,stop_loss,tp1,tp2,tp3,reasoning) values ('SELL',2000,'NaN',1990,1980,1970,'A test-only attempt to store an invalid stop.')",
      ),
      /finite_signal_prices/,
    );
  } finally {
    await db.close();
  }
});

test("rescheduled news and revoked source permission suppress obsolete notifications", async () => {
  const db = await setup();
  try {
    const source = await provider(db, "calendar");
    const base = Date.now();
    const event = {
      provider_id: source,
      reference: "reschedule-fixture",
      name: "FICTIONAL TEST EVENT",
      country: "United States",
      currency: "USD",
      event_time: new Date(base + 15 * 60000).toISOString(),
      previous: null,
      forecast: null,
      actual: null,
      importance: "high",
      source_updated_at: new Date(base).toISOString(),
      source_url: "https://example.test/fixture",
    };
    await as(db, "public");
    await db.query("select public.register_push_subscription($1)", [
      JSON.stringify({
        endpoint: "https://fcm.googleapis.com/news-test",
        keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
      }),
    ]);
    await db.query(
      "update public.notification_preferences set news=true where user_id=$1",
      [ids.public],
    );
    await assert.rejects(
      db.query("select public.queue_upcoming_calendar_events()"),
      /permission denied/,
    );
    await as(db, "service_role");
    await db.query("select public.ingest_calendar_event($1)", [
      JSON.stringify(event),
    ]);
    await db.query("select public.queue_upcoming_calendar_events()");
    await db.query("select public.prepare_push_deliveries()");
    await db.query("select public.ingest_calendar_event($1)", [
      JSON.stringify({
        ...event,
        event_time: new Date(base + 20 * 60000).toISOString(),
        source_updated_at: new Date(base + 1000).toISOString(),
      }),
    ]);
    assert.equal(
      (
        await db.query<{ jobs: unknown[] }>(
          "select public.claim_push_deliveries() as jobs",
        )
      ).rows[0].jobs.length,
      0,
    );
    await db.query("select public.queue_upcoming_calendar_events()");
    await db.query("select public.prepare_push_deliveries()");
    const claimed = (
      await db.query<{
        jobs: {
          calendar_event_id: string;
          subscription_id: string;
          outbox_id: string;
        }[];
      }>("select public.claim_push_deliveries() as jobs")
    ).rows[0].jobs;
    assert.equal(claimed.length, 1);
    assert.ok(claimed[0].calendar_event_id);
    await db.exec("reset role");
    await db.query(
      "update public.data_providers set display_allowed=false where id=$1",
      [source],
    );
    await as(db, "service_role");
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select public.notification_allowed($1,$2) as allowed",
          [claimed[0].outbox_id, claimed[0].subscription_id],
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});

test("intelligence inputs require separate current analysis rights and never bypass display rights", async () => {
  const db = await setup();
  try {
    const prices = await provider(db, "quotes");
    const calendar = await provider(db, "calendar");
    const time = new Date().toISOString();
    await as(db, "service_role");
    await quote(db, prices, "analysis-quote", 2000, 2001, time);
    const event = {
      provider_id: calendar,
      reference: "analysis-calendar",
      name: "FICTIONAL TEST CPI",
      country: "United States",
      currency: "USD",
      event_time: new Date(Date.now() + 15 * 60000).toISOString(),
      previous: null,
      forecast: "2.0%",
      actual: null,
      importance: "high",
      source_updated_at: time,
      source_url: "https://example.test/fixture",
    };
    await db.query("select public.ingest_calendar_event($1)", [
      JSON.stringify(event),
    ]);
    await as(db, "public");
    type Context = { quotes: unknown[]; events: unknown[] };
    let inputs = (
      await db.query<{ data: Context }>(
        "select public.get_intelligence_inputs() as data",
      )
    ).rows[0].data;
    assert.equal(inputs.quotes.length, 0);
    assert.equal(inputs.events.length, 0);
    await as(db, "admin");
    await assert.rejects(
      db.query("update public.data_providers set analysis_allowed=true"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec("update public.data_providers set analysis_allowed=true");
    await as(db, "public");
    inputs = (
      await db.query<{ data: Context }>(
        "select public.get_intelligence_inputs() as data",
      )
    ).rows[0].data;
    assert.equal(inputs.quotes.length, 1);
    assert.equal(inputs.events.length, 1);
    assert.equal(JSON.stringify(inputs).includes("license_reference"), false);
    await db.exec("reset role");
    await db.exec("update public.data_providers set display_allowed=false");
    await as(db, "admin");
    inputs = (
      await db.query<{ data: Context }>(
        "select public.get_intelligence_inputs() as data",
      )
    ).rows[0].data;
    assert.equal(inputs.quotes.length, 0);
    assert.equal(inputs.events.length, 0);
    await as(db, "anon");
    await assert.rejects(
      db.query("select public.get_intelligence_inputs()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("strategy and higher-timeframe metadata survive ingestion and cannot be rewritten after publication", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    const id = await draft(db);
    await db.query("select public.revise_signal($1,1,$2,$3)", [
      id,
      JSON.stringify({
        ...change,
        access: "public",
        strategy: "BOS",
        timeframe: "M30",
        higher_timeframe: "H4",
      }),
      "Add reviewed structure and higher-timeframe context",
    ]);
    await assert.rejects(
      db.query("select public.revise_signal($1,2,$2,$3)", [
        id,
        JSON.stringify({
          ...change,
          access: "public",
          strategy: "BOS",
          timeframe: "H4",
          higher_timeframe: "M30",
        }),
        "Invalid lower timeframe context",
      ]),
      /valid_signal_method/,
    );
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await db.query("select public.transition_signal($1,'active')", [id]);
    await assert.rejects(
      db.query("select public.revise_signal($1,4,$2,$3)", [
        id,
        JSON.stringify({
          ...change,
          access: "public",
          strategy: "QM",
          timeframe: "M30",
          higher_timeframe: "H4",
        }),
        "Attempt to relabel a published setup",
      ]),
      /immutable/,
    );
    const row = (
      await db.query<{
        strategy: string;
        timeframe: string;
        higher_timeframe: string;
      }>(
        "select strategy,timeframe,higher_timeframe from public.signals where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.strategy, "BOS");
    assert.equal(row.timeframe, "M30");
    assert.equal(row.higher_timeframe, "H4");
    await as(db, "service_role");
    await db.query("select public.ingest_tradingview($1,$2)", [
      JSON.stringify({
        ...change,
        strategy: "QM",
        timeframe: "H1",
        higher_timeframe: "W1",
        event_id: "test-method-alert",
        timestamp: new Date().toISOString(),
      }),
      "c".repeat(64),
    ]);
    await as(db, "admin");
    const imported = (
      await db.query<{ strategy: string; timeframe: string; status: string }>(
        "select strategy,timeframe,status from public.signals where source='tradingview'",
      )
    ).rows[0];
    assert.equal(imported.strategy, "QM");
    assert.equal(imported.timeframe, "H1");
    assert.equal(imported.status, "pending");
  } finally {
    await db.close();
  }
});

test("retired methods are rejected and administrator operations require aal2", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    await assert.rejects(
      db.query(
        "insert into public.signals(direction,entry,stop_loss,tp1,tp2,tp3,reasoning,strategy,timeframe) values ('BUY',2000,1990,2010,2020,2030,'A test-only retired method insertion.','QMTR','H1')",
      ),
      /retired/,
    );
    const id = await draft(db);
    await db.query("select set_config('request.jwt.claim.aal','aal1',false)");
    assert.equal(
      (await db.query<{ value: boolean }>("select public.is_admin() as value"))
        .rows[0].value,
      false,
    );
    await assert.rejects(
      db.query("select public.transition_signal($1,'pending')", [id]),
      /Administrator required/,
    );
    await assert.rejects(draft(db), /Administrator/);
    assert.equal(
      (await db.query("select * from public.audit_logs")).rows.length,
      0,
    );
    await db.query("select set_config('request.jwt.claim.aal','aal2',false)");
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await as(db, "service_role");
    const result = (
      await db.query<{ state: { schema_version: number } }>(
        "select public.deployment_readiness() as state",
      )
    ).rows[0].state;
    assert.equal(result.schema_version, 8);
    await as(db, "public");
    await assert.rejects(
      db.query("select public.deployment_readiness()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("engine setup metadata supports M15 through monthly and rejects M5 and new daily setups", async () => {
  const db = await setup();
  await as(db, "admin");
  const id = await draft(db);
  await db.query("select public.revise_signal($1,1,$2::jsonb,$3)", [
    id,
    JSON.stringify({
      ...change,
      strategy: "BOS",
      timeframe: "M15",
      higher_timeframe: "MN1",
    }),
    "Apply supported engine setup timeframes",
  ]);
  const { rows } = await db.query<{
    timeframe: string;
    higher_timeframe: string;
  }>("select timeframe,higher_timeframe from public.signals where id=$1", [id]);
  assert.equal(rows[0].timeframe, "M15");
  assert.equal(rows[0].higher_timeframe, "MN1");
  for (const timeframe of ["M5", "D1"])
    await assert.rejects(
      db.query("select public.revise_signal($1,2,$2::jsonb,$3)", [
        id,
        JSON.stringify({
          ...change,
          strategy: "BOS",
          timeframe,
          higher_timeframe: "MN1",
        }),
        "Reject unsupported engine timeframe",
      ]),
    );
  await db.close();
});
test("MT5 snapshots are service-only, private, ordered, replay-safe and rate-limited", async () => {
  const db = await setup();
  const time = new Date(Math.floor(Date.now() / 1000) * 1000 - 20000);
  const body = (date: Date) => ({
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    bar_time_basis: "broker_server",
    execution_enabled: false,
    exported_at_utc: date
      .toISOString()
      .slice(0, 19)
      .replace(/-/g, ".")
      .replace("T", " "),
  });
  await as(db, "public");
  await assert.rejects(
    db.query("select public.ingest_mt5_snapshot($1,$2,$3)", [
      JSON.stringify(body(time)),
      "a".repeat(64),
      time.toISOString(),
    ]),
  );
  await assert.rejects(db.query("select * from public.mt5_bridge_latest"));
  await as(db, "service_role");
  const first = await db.query<{ result: { duplicate: boolean } }>(
    "select public.ingest_mt5_snapshot($1,$2,$3) result",
    [JSON.stringify(body(time)), "a".repeat(64), time.toISOString()],
  );
  assert.equal(first.rows[0].result.duplicate, false);
  const replay = await db.query<{ result: { duplicate: boolean } }>(
    "select public.ingest_mt5_snapshot($1,$2,$3) result",
    [JSON.stringify(body(time)), "a".repeat(64), time.toISOString()],
  );
  assert.equal(replay.rows[0].result.duplicate, true);
  await assert.rejects(
    db.query("select public.ingest_mt5_snapshot($1,$2,$3)", [
      JSON.stringify(body(time)),
      "b".repeat(64),
      time.toISOString(),
    ]),
  );
  const older = new Date(time.getTime() - 1000);
  await assert.rejects(
    db.query("select public.ingest_mt5_snapshot($1,$2,$3)", [
      JSON.stringify(body(older)),
      "b".repeat(64),
      older.toISOString(),
    ]),
  );
  await db.query(
    "insert into mt5_bridge_receipts(exported_at,fingerprint) select $1::timestamptz - i * interval '1 millisecond', repeat('d',64) from generate_series(1,89) i",
    [time.toISOString()],
  );
  const excess = new Date(time.getTime() + 1000);
  await assert.rejects(
    db.query("select public.ingest_mt5_snapshot($1,$2,$3)", [
      JSON.stringify(body(excess)),
      "c".repeat(64),
      excess.toISOString(),
    ]),
  );
  const count = await db.query<{ total: number }>(
    "select count(*)::integer total from public.mt5_bridge_latest",
  );
  assert.equal(count.rows[0].total, 1);
  await db.close();
});
async function autoFixture(db: PGlite, options: { ask?: boolean } = {}) {
  const date = new Date(Math.floor(Date.now() / 1000) * 1000 - 10000),
    server = Math.floor(date.getTime() / 1000) + 10800;
  const stamp = server - 599;
  const candle = (open: number, close = 100) => ({
    opened_at_server_raw: open,
    open: 100,
    high: 110,
    low: 90,
    close,
    tick_volume: 50,
    real_volume: null,
    spread_points: 20,
  });
  const feed = (offset = 0, bid = 100, close = 100) => ({
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    bar_time_basis: "broker_server",
    execution_enabled: false,
    exported_at_utc: new Date(date.getTime() + offset * 1000)
      .toISOString()
      .slice(0, 19)
      .replace(/-/g, ".")
      .replace("T", " "),
    server_time_raw: server + offset,
    quote: {
      bid,
      ask: bid + 0.2,
      last_tick_time_raw: server + offset,
      last_tick_time_msc_raw: (server + offset) * 1000,
    },
    series: [
      {
        timeframe: "M5",
        candles: [candle(offset ? stamp + 300 : stamp, close)],
      },
      ...[
        { timeframe: "M30", duration: 1800, high: 105, low: 95 },
        { timeframe: "H1", duration: 3600, high: 110, low: 90 },
        { timeframe: "H4", duration: 14400, high: 120, low: 80 },
      ].map((f) => ({
        timeframe: f.timeframe,
        candles: Array.from({ length: 5 }, (_, i) => ({
          ...candle(stamp + 300 - (5 - i) * f.duration),
          high: i === 2 ? f.high : 101,
          low: i === 2 ? f.low : 99,
        })),
      })),
    ],
    ...(options.ask
      ? { ask_m5: [candle(offset ? stamp + 300 : stamp, close)] }
      : {}),
  });
  const put = async (offset = 0, bid = 100, close = 100) => {
    const snapshot = feed(offset, bid, close),
      time = new Date(date.getTime() + offset * 1000).toISOString();
    await db.query("select public.ingest_mt5_snapshot($1,$2,$3)", [
      JSON.stringify(snapshot),
      String(offset).padStart(64, "f"),
      time,
    ]);
    return time;
  };
  const plan = {
    version: "vestrado-structure-v1",
    provider: "Vestrado MT5",
    sourceEventId: "1".repeat(64),
    method: "BOS",
    timeframe: "M15",
    higherTimeframe: "M30",
    direction: "BUY",
    entry: 100.2,
    zoneLow: 99,
    zoneHigh: 101,
    stop: 96,
    targets: [105, 110, 120],
    reason:
      "Automatic fixture with structural targets and completed M5 confirmation.",
    confirmationOpenedServer: stamp,
    breakoutOpenedServer: stamp - 900,
  };
  return { date, plan, put };
}
test("automatic policy requires MFA admin; engine publication and outbox are atomic and deduplicated", async () => {
  const db = await setup();
  await as(db, "public");
  await assert.rejects(db.query("select public.set_automatic_engine(true)"));
  await as(db, "admin");
  await db.query("select set_config('request.jwt.claim.aal','aal1',false)");
  await assert.rejects(db.query("select public.set_automatic_engine(true)"));
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const f = await autoFixture(db),
    time = await f.put();
  const apply = () =>
    db.query<{ result: { published: number } }>(
      "select public.apply_automatic_engine($1,$2) result",
      [time, JSON.stringify([f.plan])],
    );
  await assert.rejects(
    db.query("select public.apply_automatic_engine($1,$2)", [
      time,
      JSON.stringify([{ ...f.plan, targets: [103, 104, 105] }]),
    ]),
    /Higher timeframe targets mismatch/,
  );
  assert.equal((await apply()).rows[0].result.published, 1);
  assert.equal((await apply()).rows[0].result.published, 0);
  await as(db, "admin");
  const rows = await db.query<{
    status: string;
    source: string;
    entry_low: number;
  }>("select status,source,entry_low from public.signals where source='mt5'");
  assert.equal(rows.rows[0].status, "active");
  assert.equal(rows.rows[0].source, "mt5");
  const out = await db.query<{ total: number }>(
    "select count(*)::integer total from public.notification_outbox where event_type='signal.active'",
  );
  assert.equal(out.rows[0].total, 1);
  await as(db, "public");
  await assert.rejects(
    db.query("select public.apply_automatic_engine($1,$2)", [time, "[]"]),
  );
  await db.close();
});
test("automatic plans fail closed on wrong SL buffer and SELL without ask history", async () => {
  const db = await setup();
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const f = await autoFixture(db),
    time = await f.put();
  await assert.rejects(
    db.query("select public.apply_automatic_engine($1,$2)", [
      time,
      JSON.stringify([{ ...f.plan, stop: 95 }]),
    ]),
  );
  await assert.rejects(
    db.query("select public.apply_automatic_engine($1,$2)", [
      time,
      JSON.stringify([
        {
          ...f.plan,
          direction: "SELL",
          entry: 100,
          stop: 104,
          targets: [95, 90, 80],
        },
      ]),
    ]),
  );
  await as(db, "admin");
  const count = await db.query<{ total: number }>(
    "select count(*)::integer total from public.signals",
  );
  assert.equal(count.rows[0].total, 0);
  await db.close();
});
test("automatic SL ignores wicks until an inclusive M5 close", async () => {
  const db = await setup();
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const f = await autoFixture(db),
    first = await f.put();
  await db.query("select public.apply_automatic_engine($1,$2)", [
    first,
    JSON.stringify([f.plan]),
  ]);
  const next = await f.put(1, 95, 96.01);
  await db.query("select public.apply_automatic_engine($1,$2)", [next, "[]"]);
  await as(db, "admin");
  const still = await db.query<{ status: string }>(
    "select status from public.signals",
  );
  assert.equal(still.rows[0].status, "active");
  // Use an independent plan lifecycle to test a close strictly beyond SL on that first next candle.
  await db.close();
  const db2 = await setup();
  await as(db2, "admin");
  await db2.query("select public.set_automatic_engine(true)");
  await as(db2, "service_role");
  const g = await autoFixture(db2),
    initial = await g.put();
  await db2.query("select public.apply_automatic_engine($1,$2)", [
    initial,
    JSON.stringify([g.plan]),
  ]);
  const invalid = await g.put(1, 100, 96);
  await db2.query("select public.apply_automatic_engine($1,$2)", [
    invalid,
    "[]",
  ]);
  await as(db2, "admin");
  const stopped = await db2.query<{ status: string; outcome: string | null }>(
    "select status,outcome from public.signals",
  );
  assert.equal(stopped.rows[0].status, "closed");
  assert.equal(stopped.rows[0].outcome, null);
  const out = await db2.query<{ total: number }>(
    "select count(*)::integer total from public.notification_outbox where event_type='signal.stop_hit'",
  );
  assert.equal(out.rows[0].total, 1);
  await db2.close();
});
test("automatic targets and partial instruction create each event once and never claim broker profit", async () => {
  const db = await setup();
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const f = await autoFixture(db),
    time = await f.put();
  await db.query("select public.apply_automatic_engine($1,$2)", [
    time,
    JSON.stringify([f.plan]),
  ]);
  const one = await f.put(1, 106.1);
  await db.query("select public.apply_automatic_engine($1,$2)", [one, "[]"]);
  await db.query("select public.apply_automatic_engine($1,$2)", [one, "[]"]);
  const all = await f.put(2, 121);
  await db.query("select public.apply_automatic_engine($1,$2)", [all, "[]"]);
  await as(db, "admin");
  const events = await db.query<{ event_type: string }>(
    "select event_type from public.notification_outbox where event_type<>'signal.active' order by event_type",
  );
  assert.deepEqual(
    events.rows.map((e) => e.event_type),
    ["signal.break_even", "signal.tp1", "signal.tp2", "signal.tp3"],
  );
  const result = await db.query<{ status: string; outcome: string | null }>(
    "select status,outcome from public.signals",
  );
  assert.equal(result.rows[0].status, "closed");
  assert.equal(result.rows[0].outcome, null);
  await db.close();
});
test("paused new publication preserves existing monitoring; data gaps suppress guessed outcomes", async () => {
  const db = await setup();
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const f = await autoFixture(db),
    first = await f.put();
  await db.query("select public.apply_automatic_engine($1,$2)", [
    first,
    JSON.stringify([f.plan]),
  ]);
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(false)");
  await as(db, "service_role");
  const next = await f.put(1, 106.1);
  await db.query("select public.apply_automatic_engine($1,$2)", [
    next,
    JSON.stringify([{ ...f.plan, sourceEventId: "2".repeat(64) }]),
  ]);
  await as(db, "admin");
  const signals = await db.query<{ total: number }>(
    "select count(*)::integer total from public.signals",
  );
  assert.equal(signals.rows[0].total, 1);
  const target = await db.query<{ total: number }>(
    "select count(*)::integer total from public.notification_outbox where event_type='signal.tp1'",
  );
  assert.equal(target.rows[0].total, 1);
  await db.close();
  const db2 = await setup();
  await as(db2, "admin");
  await db2.query("select public.set_automatic_engine(true)");
  await as(db2, "service_role");
  const g = await autoFixture(db2),
    time = await g.put();
  await db2.query("select public.apply_automatic_engine($1,$2)", [
    time,
    JSON.stringify([g.plan]),
  ]);
  await db2.query(
    "update public.automatic_engine_tracking set last_snapshot=last_snapshot-interval '2 minutes'",
  );
  const gap = await g.put(1, 121);
  await db2.query("select public.apply_automatic_engine($1,$2)", [gap, "[]"]);
  await as(db2, "admin");
  const row = await db2.query<{
    reconciliation_state: string;
    outcome: string | null;
    tp1_hit_at: string | null;
  }>("select reconciliation_state,outcome,tp1_hit_at from public.signals");
  assert.equal(row.rows[0].reconciliation_state, "gap");
  assert.equal(row.rows[0].outcome, null);
  assert.equal(row.rows[0].tp1_hit_at, null);
  await db2.close();
});
test("SELL SL uses inclusive ask M5 close, not quote touches", async () => {
  const db = await setup();
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const f = await autoFixture(db, { ask: true }),
    time = await f.put();
  const sell = {
    ...f.plan,
    direction: "SELL",
    entry: 100,
    stop: 104,
    targets: [95, 90, 80],
  };
  await db.query("select public.apply_automatic_engine($1,$2)", [
    time,
    JSON.stringify([sell]),
  ]);
  const next = await f.put(1, 100, 104);
  await db.query("select public.apply_automatic_engine($1,$2)", [next, "[]"]);
  await as(db, "admin");
  const row = await db.query<{ status: string; outcome: string | null }>(
    "select status,outcome from public.signals",
  );
  assert.equal(row.rows[0].status, "closed");
  assert.equal(row.rows[0].outcome, null);
  await db.close();
});

import { scanTickVolume } from "../lib/engine/tick-volume";
function tickFixture(sell = false) {
  const server = Math.floor(Date.now() / 1000);
  const candles = Array.from({ length: 50 }, (_, i) => {
    const high =
      i === 5
        ? 2730
        : i === 15
          ? 2720
          : i === 25
            ? 2710
            : i === 49
              ? 2705
              : 2706;
    const low =
      i === 10
        ? 2680
        : i === 20
          ? 2685
          : i === 35
            ? 2690
            : i === 49
              ? 2699
              : 2695;
    const b = {
      opened_at_server_raw: server - (50 - i) * 300,
      open: 2700,
      close: 2704,
      high,
      low,
      tick_volume: i === 49 ? 150 : 100,
      real_volume: null,
      spread_points: 20,
    };
    return sell
      ? {
          ...b,
          open: 5400 - b.open,
          close: 5400 - b.close,
          high: 5400 - b.low,
          low: 5400 - b.high,
        }
      : b;
  });
  const exported = new Date(server * 1000)
    .toISOString()
    .slice(0, 19)
    .replaceAll("-", ".")
    .replace("T", " ");
  return {
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    exported_at_utc: exported,
    bar_time_basis: "broker_server",
    server_time_raw: server,
    digits: 2,
    point: 0.01,
    quote: {
      bid: sell ? 2696 : 2704,
      ask: sell ? 2696.2 : 2704.2,
      last_tick_time_raw: server,
      last_tick_time_msc_raw: server * 1000,
    },
    series: ["M5", "M15", "M30", "H1", "H4", "W1", "MN1"].map((timeframe) => ({
      timeframe,
      availability: ["M5", "M30"].includes(timeframe)
        ? "available"
        : "unavailable",
      candles:
        timeframe === "M5"
          ? candles
          : timeframe === "M30"
            ? candles.map((b, i) => ({
                ...b,
                opened_at_server_raw: server - (50 - i) * 1800,
              }))
            : [],
    })),
    ask_m5: sell
      ? [
          {
            ...candles.at(-1)!,
            open: candles.at(-1)!.open + 0.2,
            close: candles.at(-1)!.close + 0.2,
            high: candles.at(-1)!.high + 0.2,
            low: candles.at(-1)!.low + 0.2,
          },
        ]
      : [],
    order_book: null,
    aggressive_buy_sell_imbalance: null,
    execution_enabled: false,
  };
}
test("tick publication is member, duplicate-safe, structural and monitored through the existing lifecycle", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    await db.query("select public.set_automatic_engine(true)");
    await as(db, "service_role");
    await db.exec(
      "update public.tick_volume_policy set enabled=true where singleton",
    );
    const snapshot = tickFixture();
    const exportTime = new Date(snapshot.server_time_raw * 1000).toISOString();
    await db.query(
      "insert into public.mt5_bridge_latest(source,snapshot,exported_at,received_at) values('vestrado',$1,$2,now())",
      [snapshot, exportTime],
    );
    const proposal = scanTickVolume(snapshot, Date.now());
    assert.equal(proposal.status, "risk_ready");
    const apply = () =>
      db.query<{ r: { published: number } }>(
        "select public.apply_tick_volume($1,$2) r",
        [exportTime, proposal],
      );
    assert.equal((await apply()).rows[0].r.published, 1);
    assert.equal((await apply()).rows[0].r.published, 0);
    const row = (
      await db.query<{ id: string; stop_loss: string; tp1: string }>(
        "select * from public.signals where strategy='TICK_VOLUME'",
      )
    ).rows[0];
    assert.equal(Number(row.stop_loss), 2690);
    assert.equal(Number(row.tp1), 2710);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.notification_outbox where signal_id=$1 and event_type='signal.active' and access='public'",
          [row.id],
        )
      ).rows[0].n,
      1,
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      1,
    );
    await assert.rejects(apply(), /permission denied/);
    await as(db, "member");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      1,
    );
    await as(db, "service_role");
    // Update current observed quote to TP1 without inventing broker fills.
    const next = structuredClone(snapshot);
    next.quote.bid = 2710;
    next.quote.ask = 2710.2;
    const t2 = new Date(snapshot.server_time_raw * 1000 + 1000).toISOString();
    await db.query(
      "update public.mt5_bridge_latest set snapshot=$1,exported_at=$2,received_at=now() where source='vestrado'",
      [next, t2],
    );
    await db.query("select public.apply_automatic_engine($1,'[]'::jsonb)", [
      t2,
    ]);
    await db.query("select public.apply_automatic_engine($1,'[]'::jsonb)", [
      t2,
    ]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.notification_outbox where signal_id=$1 and event_type='signal.tp1'",
          [row.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("tick publication blocks unconfirmed SELL evidence and disabled policy", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    await db.query("select public.set_automatic_engine(true)");
    await as(db, "service_role");
    const snapshot = tickFixture(true);
    const proposal = scanTickVolume(snapshot, Date.now());
    assert.equal(proposal.status, "risk_ready");
    const t = new Date(snapshot.server_time_raw * 1000).toISOString();
    snapshot.ask_m5 = [];
    await db.query(
      "insert into public.mt5_bridge_latest(source,snapshot,exported_at,received_at) values('vestrado',$1,$2,now())",
      [snapshot, t],
    );
    const apply = () =>
      db.query<{ r: { reason: string; published: number } }>(
        "select public.apply_tick_volume($1,$2) r",
        [t, proposal],
      );
    assert.equal((await apply()).rows[0].r.reason, "paused");
    await db.exec(
      "update public.tick_volume_policy set enabled=true where singleton",
    );
    assert.equal((await apply()).rows[0].r.reason, "sell_ask_history_missing");
    snapshot.ask_m5 = tickFixture(true).ask_m5;
    // Keep the evidence tied to the exact confirmation candle, independent of wall-clock drift.
    snapshot.ask_m5[0].opened_at_server_raw =
      snapshot.series[0].candles.at(-1)!.opened_at_server_raw;
    await db.query(
      "update public.mt5_bridge_latest set snapshot=$1 where source='vestrado'",
      [snapshot],
    );
    const forged = structuredClone(proposal);
    forged.risk!.stop += 1;
    await assert.rejects(
      db.query("select public.apply_tick_volume($1,$2)", [t, forged]),
      /Structural levels mismatch/,
    );
    assert.equal((await apply()).rows[0].r.published, 1);
    assert.equal((await apply()).rows[0].r.published, 0);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.signals",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("50-pip alert uses entry inclusive for BUY and SELL, survives retrace and is emitted once", async () => {
  for (const buy of [true, false]) {
    const db = await setup();
    await as(db, "admin");
    await db.query("select public.set_automatic_engine(true)");
    await as(db, "service_role");
    const f = await autoFixture(db, { ask: true });
    if (!buy)
      Object.assign(f.plan, {
        direction: "SELL",
        entry: 100,
        stop: 104,
        targets: [95, 90, 80],
      });
    const base = f.plan.entry;
    const time = await f.put();
    await db.query("select public.apply_automatic_engine($1,$2)", [
      time,
      JSON.stringify([f.plan]),
    ]);
    const tick = async (offset: number, exitPrice: number, close = 100) => {
      const at = await f.put(offset, buy ? exitPrice - 0.2 : exitPrice, close);
      await db.query("select public.apply_automatic_engine($1,'[]'::jsonb)", [
        at,
      ]);
    };
    await tick(1, buy ? base + 4.99 : base - 4.99);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from notification_outbox where event_type='signal.break_even'",
        )
      ).rows[0].n,
      0,
    );
    await tick(2, buy ? base + 5 : base - 5);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from notification_outbox where event_type='signal.break_even'",
        )
      ).rows[0].n,
      1,
    );
    await tick(3, buy ? base + 6 : base - 6);
    await tick(4, base);
    const events = await db.query<{ n: number }>(
      "select count(*)::int n from notification_outbox where event_type='signal.break_even'",
    );
    assert.equal(events.rows[0].n, 1);
    const result = await db.query<{
      break_even: boolean;
      max_favorable_movement: string;
      outcome: null;
    }>("select break_even,max_favorable_movement,outcome from signals");
    assert.equal(result.rows[0].break_even, true);
    assert.equal(Number(result.rows[0].max_favorable_movement), 6);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from notification_outbox where event_type='signal.be_hit'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query<{ status: string }>("select status from signals")).rows[0]
        .status,
      "closed",
    );
    await tick(5, base);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from notification_outbox where event_type='signal.be_hit'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from notification_outbox where event_type='signal.stop_hit'",
        )
      ).rows[0].n,
      0,
    );

    assert.equal(result.rows[0].outcome, null);
    assert.equal(
      Number(
        (await db.query<{ stop_loss: string }>("select stop_loss from signals"))
          .rows[0].stop_loss,
      ),
      f.plan.stop,
    );
    await db.close();
  }
});

test("wide zone needs a genuine outside-then-return after 50 pips before BE closes monitoring", async () => {
  const db = await setup();
  await as(db, "admin");
  await db.query("select public.set_automatic_engine(true)");
  await as(db, "service_role");
  const id = (
    await db.query<{ id: string }>(
      "insert into signals(direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,engine_version,source_event_id,source_fingerprint) values('BUY',100,99,107,96,110,115,120,'Wide-zone management fixture with confirmed quote observations.','public','mt5','vestrado-structure-v1',repeat('b',64),repeat('b',64)) returning id",
    )
  ).rows[0].id;
  await db.query(
    "update signals set status='active',published_at=now(),approved_by=$1 where id=$2",
    [ids.admin, id],
  );
  const f = await autoFixture(db);
  const first = await f.put();
  await db.query(
    "insert into automatic_engine_tracking(signal_id,last_snapshot,last_m5_open) values($1,$2,$3)",
    [id, first, f.plan.confirmationOpenedServer],
  );
  const tick = async (offset: number, price: number) => {
    const at = await f.put(offset, price);
    await db.query("select apply_automatic_engine($1,'[]'::jsonb)", [at]);
  };
  await tick(1, 105);
  await tick(2, 106);
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from notification_outbox where event_type='signal.be_hit'",
      )
    ).rows[0].n,
    0,
  );
  await tick(3, 108);
  await tick(4, 107);
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from notification_outbox where event_type='signal.be_hit'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from signals where id=$1",
        [id],
      )
    ).rows[0].status,
    "closed",
  );
  await db.close();
});

test("trendline structural stops are recomputed from snapshot evidence and cannot be forged", async () => {
  const { fixture, mirror } = await import("./helpers/trendline-fixture");
  const { previewTrendline } = await import("../lib/engine/trendline-preview");
  const db = await setup();
  for (const x of [
    fixture(),
    mirror(fixture()),
    fixture(true),
    mirror(fixture(true)),
  ]) {
    const [proposal] = previewTrendline(x);
    assert.ok(proposal);
    const snapshot = {
      series: [
        { timeframe: "M15", candles: x.setupBars },
        { timeframe: "M5", candles: x.m5Bars },
      ],
      quote: { bid: x.bid, ask: x.ask },
      point: x.point,
    };
    const plan = {
      method: "TRENDLINE",
      timeframe: "M15",
      direction: proposal.direction,
      zoneLow: proposal.zoneLow,
      zoneHigh: proposal.zoneHigh,
      stop: proposal.stop,
      targets: [proposal.target],
      confirmationOpenedServer: proposal.confirmationOpened,
      breakoutOpenedServer: proposal.eventOpened,
      trendline: {
        version: proposal.version,
        precision: "point",
        subtype: proposal.subtype,
        anchors: proposal.anchors,
        eventOpened: proposal.eventOpened,
        confirmationOpened: proposal.confirmationOpened,
      },
    };
    const check = async (value: unknown) =>
      (
        await db.query<{ valid: boolean }>(
          "select public.valid_trendline_v2_plan($1,$2) valid",
          [JSON.stringify(snapshot), JSON.stringify(value)],
        )
      ).rows[0].valid;
    assert.equal(await check(plan), true);
    assert.equal(await check({ ...plan, stop: plan.stop + 1 }), false);
    assert.equal(
      await check({
        ...plan,
        trendline: { ...plan.trendline, anchors: [1, proposal.anchors[1]] },
      }),
      false,
    );
    assert.equal(await check({ ...plan, zoneLow: plan.zoneLow - 0.1 }), false);
    assert.equal(
      await check({
        ...plan,
        trendline: { ...plan.trendline, subtype: "invalid" },
      }),
      false,
    );
    assert.equal(await check({ ...plan, targets: [proposal.entry] }), false);
  }
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('anon','public.valid_trendline_v2_plan(jsonb,jsonb)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('authenticated','public.valid_trendline_v2_plan(jsonb,jsonb)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await db.close();
});

test("single member access removes tier grants while retaining administrator and anonymous boundaries", async () => {
  const db = await setup();
  await as(db, "admin");
  const id = await draft(db);
  await db.query("select public.transition_signal($1,'pending')", [id]);
  await db.query("select public.transition_signal($1,'active')", [id]);
  for (const role of ["public", "member"] as const) {
    await as(db, role);
    assert.equal(
      (await db.query("select * from public.signals where id=$1", [id])).rows
        .length,
      1,
    );
    await assert.rejects(
      db.query("select public.transition_signal($1,'closed')", [id]),
      /Administrator required/,
    );
  }
  await as(db, "anon");
  await assert.rejects(
    db.query("select * from public.signals"),
    /permission denied/,
  );
  await db.exec("reset role");
  await assert.rejects(
    db.query("update public.profiles set role='vip' where id=$1", [ids.public]),
    /profiles_member_or_admin/,
  );
  await assert.rejects(
    db.query("update public.signals set access='vip' where id=$1", [id]),
    /signals_member_audience/,
  );
  const state = (
    await db.query<{
      membership: string | null;
      role_rpc: string | null;
      old_helper: string | null;
    }>(
      "select to_regclass('public.membership_entitlements')::text membership,to_regprocedure('public.set_member_role(uuid,text)')::text role_rpc,to_regprocedure('public.has_vip()')::text old_helper",
    )
  ).rows[0];
  assert.deepEqual(state, {
    membership: null,
    role_rpc: null,
    old_helper: null,
  });
  assert.equal(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from public.profiles where role='admin'",
      )
    ).rows[0].count,
    1,
  );
  await db.close();
});

test("admin performance counts highest TP once, replaces running, protects access and retains history", async () => {
  const db = await setup();
  try {
    await as(db, "admin");
    const id = await draft(db);
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await db.query("select public.transition_signal($1,'active')", [id]);
    const report = async () =>
      (
        await db.query<{ r: any }>(
          "select public.get_admin_signal_performance(now()-interval '1 day',now()+interval '1 day') r",
        )
      ).rows[0].r;
    let r = await report();
    assert.equal(r.summary.signals, 1);
    assert.equal(r.summary.total_pips, 0);
    await db.exec("reset role");
    const ledgerBefore = (
      await db.query<any>(
        "select updated_at from public.signal_performance_ledger where id=$1",
        [id],
      )
    ).rows[0].updated_at;
    await db.query(
      "update public.signals set max_favorable_movement=1 where id=$1",
      [id],
    );
    assert.deepEqual(
      (
        await db.query<any>(
          "select updated_at from public.signal_performance_ledger where id=$1",
          [id],
        )
      ).rows[0].updated_at,
      ledgerBefore,
    );
    await db.query("update public.signals set break_even=true where id=$1", [
      id,
    ]);
    await as(db, "admin");
    r = await report();
    assert.equal(r.summary.running_pips, 50);
    assert.equal(r.summary.wins, 0);
    await db.exec("reset role");
    await db.query("update public.signals set tp1_hit_at=now() where id=$1", [
      id,
    ]);
    await as(db, "admin");
    r = await report();
    assert.equal(r.summary.total_pips, 100);
    assert.equal(r.summary.running_pips, 0);
    assert.equal(r.summary.wins, 1);
    await db.exec("reset role");
    await db.query(
      "update public.signals set tp2_hit_at=now(),tp3_hit_at=now(),stop_observed_at=now(),status='closed',closed_at=now() where id=$1",
      [id],
    );
    await as(db, "admin");
    r = await report();
    assert.equal(r.summary.total_pips, 300);
    assert.equal(r.summary.wins, 1);
    assert.equal(r.summary.losses, 0);
    assert.equal(r.summary.sl_hits, 1);
    assert.equal(r.summary.win_rate, 100);
    for (const role of ["public", "member"] as const) {
      await as(db, role);
      assert.equal(
        (await db.query("select * from public.signal_performance_ledger")).rows
          .length,
        0,
      );
      await assert.rejects(report(), /MFA administrator required/);
      const summary = (
        await db.query<{ r: any }>(
          "select public.get_member_signal_summary() r",
        )
      ).rows[0].r;
      assert.equal(summary.active_count, 0);
    }
    await as(db, "admin");
    await db.exec("select set_config('request.jwt.claim.aal','aal1',false)");
    await assert.rejects(report(), /MFA administrator required/);
    assert.equal(
      (await db.query("select * from public.signal_performance_ledger")).rows
        .length,
      0,
    );
    await as(db, "anon");
    await assert.rejects(report(), /permission denied/);
    await assert.rejects(
      db.query("select public.get_member_signal_summary()"),
      /permission denied/,
    );
    await db.exec("reset role");
    // Cleanup of source rows must not erase the small historical performance ledger.
    await db.query(
      "delete from public.notification_outbox where signal_id=$1",
      [id],
    );
    await db.query("delete from public.signals where id=$1", [id]);
    await as(db, "admin");
    r = await report();
    assert.equal(r.summary.total_pips, 300);
    assert.equal(r.signals[0].source_signal_id, null);
  } finally {
    await db.close();
  }
});

test("performance formula handles sell, SL, BE, provisional expiry and MYT boundaries", async () => {
  const db = await setup();
  try {
    await db.exec("reset role");
    // Synthetic ledger records exist only inside isolated PGlite, never production.
    const calc = async (state: Record<string, unknown>) =>
      (
        await db.query<{ r: any }>(
          `select to_jsonb(m) r from public.signal_performance_metrics(jsonb_populate_record(null::public.signal_performance_ledger,$1::jsonb)) m`,
          [
            JSON.stringify({
              direction: "SELL",
              entry: 2000,
              stop_loss: 2010,
              tp1: 1990,
              tp2: 1980,
              tp3: 1970,
              status: "active",
              be_alert: false,
              ...state,
            }),
          ],
        )
      ).rows[0].r;
    assert.equal(
      (await calc({ tp2_hit_at: new Date().toISOString() })).total_pips,
      200,
    );
    assert.equal(
      (
        await calc({
          be_alert: true,
          stop_observed_at: new Date().toISOString(),
          sl_hit_at: new Date().toISOString(),
          status: "closed",
        })
      ).total_pips,
      -100,
    );
    assert.equal(
      (
        await calc({
          be_alert: true,
          be_exit_at: new Date().toISOString(),
          status: "closed",
        })
      ).outcome,
      "BE",
    );
    assert.equal(
      (await calc({ be_alert: true, status: "closed" })).total_pips,
      0,
    );
    assert.equal(
      (await calc({ be_alert: true, status: "closed" })).outcome,
      "Unclassified",
    );
    const before = (
      await db.query<any>(
        "select * from public.signal_session_bounds('2026-11-04T21:29:59Z')",
      )
    ).rows[0];
    const gap = (
      await db.query<any>(
        "select * from public.signal_session_bounds('2026-11-04T21:30:00Z')",
      )
    ).rows[0];
    const start = (
      await db.query<any>(
        "select * from public.signal_session_bounds('2026-11-04T22:00:00Z')",
      )
    ).rows[0];
    assert.equal(
      new Date(before.session_start).toISOString(),
      "2026-11-03T22:00:00.000Z",
    );
    assert.equal(before.in_break, false);
    assert.equal(gap.in_break, true);
    assert.equal(start.in_break, false);
    assert.equal(
      new Date(start.session_reset).toISOString(),
      "2026-11-05T21:30:00.000Z",
    );
  } finally {
    await db.close();
  }
});

test("performance aggregates full range beyond detail cap and captures BE alerts without notifications", async () => {
  const db = await setup();
  try {
    await db.exec("reset role");
    await db.exec(`insert into public.signal_performance_ledger(id,published_at,strategy,timeframe,higher_timeframe,direction,entry,stop_loss,tp1,tp2,tp3,status,tp1_hit_at)
   select gen_random_uuid(),now(),'QM','M30','H1','BUY',2000,1990,2010,2020,2030,'closed',now() from generate_series(1,205)`);
    await as(db, "admin");
    const get = async (strategy: string | null = null) =>
      (
        await db.query<{ r: any }>(
          "select public.get_admin_signal_performance(now()-interval '1 day',now()+interval '1 day',$1,null) r",
          [strategy],
        )
      ).rows[0].r;
    let r = await get();
    assert.equal(r.summary.signals, 205);
    assert.equal(r.summary.total_pips, 20500);
    assert.equal(r.signals.length, 200);
    assert.equal(r.by_setup[0].signals, 205);
    assert.equal((await get("BOS")).summary.signals, 0);
    await assert.rejects(
      db.query(
        "select public.get_admin_signal_performance(now()-interval '367 days',now())",
      ),
      /366 days/,
    );
    const id = await draft(db);
    await db.query("select public.transition_signal($1,'pending')", [id]);
    await db.query("select public.transition_signal($1,'active')", [id]);
    await db.exec("reset role");
    await db.query(
      "insert into public.notification_outbox(event_key,signal_id,event_type,access,payload) values ($1,$2,'signal.break_even','public','{}'),($3,$2,'signal.be_hit','public','{}')",
      [`${id}:test-be`, id, `${id}:test-return`],
    );
    await as(db, "admin");
    r = await get();
    assert.equal(r.summary.be, 1);
    assert.equal(r.summary.running_pips, 0);
    assert.equal(r.summary.be_alerts, 1);
  } finally {
    await db.close();
  }
});

test("client recent desk curates existing TP history once and retains all future results with admin archive access", async () => {
  const db = await setup(true);
  try {
    const existing: string[] = [];
    for (let i = 0; i < 5; i++) {
      await as(db, "admin");
      const id = await draft(db);
      existing.push(id);
      await db.query("select public.transition_signal($1,'pending')", [id]);
      await db.query("select public.transition_signal($1,'active')", [id]);
      await db.exec("reset role");
      await db.query(
        "update public.signals set status='closed',closed_at=now(),tp1_hit_at=case when $2 then now() else null end where id=$1",
        [id, i < 2],
      );
    }
    const migration =
      process.env.PANTHER_RECENT_SQL ??
      `supabase/migrations/${(await readdir("supabase/migrations")).find((f) => f.endsWith("_client_recent_signal_desk.sql"))}`;
    await db.exec(await readFile(migration, "utf8"));
    await as(db, "public");
    let rows = (await db.query<{ id: string }>("select id from public.signals"))
      .rows;
    assert.deepEqual(rows.map((r) => r.id).sort(), existing.slice(0, 2).sort());
    await as(db, "admin");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      5,
    );
    assert.equal(
      (await db.query("select * from public.signal_performance_ledger")).rows
        .length,
      5,
    );
    const future = await draft(db);
    await db.query("select public.transition_signal($1,'pending')", [future]);
    await db.query("select public.transition_signal($1,'active')", [future]);
    await db.exec("reset role");
    await db.query(
      "update public.signals set status='closed',closed_at=now(),stop_observed_at=now() where id=$1",
      [future],
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select id from public.signals where id=$1", [future]))
        .rows.length,
      1,
    );
    await db.exec("reset role");
    await db.query(
      "update public.signals set published_at=now()-interval '31 days' where id=$1",
      [future],
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select id from public.signals where id=$1", [future]))
        .rows.length,
      0,
    );
    await as(db, "admin");
    assert.equal(
      (await db.query("select id from public.signals where id=$1", [future]))
        .rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select id from public.signal_performance_ledger where id=$1",
          [future],
        )
      ).rows.length,
      1,
    );
    const active = await draft(db);
    await db.query("select public.transition_signal($1,'pending')", [active]);
    await db.query("select public.transition_signal($1,'active')", [active]);
    await db.exec("reset role");
    await db.query(
      "update public.signals set published_at=now()-interval '31 days' where id=$1",
      [active],
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select id from public.signals where id=$1", [active]))
        .rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});

test("client onboarding protects credentials, enforces server-side access and queues admin-only decisions atomically", async () => {
  const db = await setup();
  try {
    await as(db, "service_role");
    const details = {
      full_name: "Client One",
      email: "client@example.test",
      phone: "+60123456789",
      client_id: "IB-1",
      mt5_login: "12345",
      server: "Vestrado-Live",
    };
    await db.query("select public.submit_client_application($1,$2,$3)", [
      ids.public,
      details,
      "v1.encrypted.test.credential",
    ]);
    await assert.rejects(
      db.query("select public.submit_client_application($1,$2,$3)", [
        ids.member,
        { ...details, server: "vestrado-live" },
        "v1.encrypted.test.credential",
      ]),
      /duplicate key/,
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.client_applications")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("select * from public.client_credentials"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update public.client_applications set status='approved'"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.submit_client_application($1,$2,$3)", [
        ids.member,
        details,
        "v1.encrypted.test.credential",
      ]),
      /permission denied/,
    );
    await as(db, "member");
    assert.equal(
      (await db.query("select * from public.client_applications")).rows.length,
      0,
    );
    await as(db, "admin");
    await assert.rejects(
      db.query("select public.set_client_gate(true)"),
      /Verify a live client/,
    );
    await as(db, "service_role");
    const a = (
      await db.query<{ revision: string }>(
        "select revision from public.client_applications where user_id=$1",
        [ids.public],
      )
    ).rows[0];
    const result = {
      status: "approved",
      reason: "eligible",
      funded_at: new Date().toISOString(),
      last_trade_at: null,
      balance: 300,
      equity: 300,
      credit: 0,
      deposits: 300,
      withdrawals: 0,
    };
    const stamp = new Date().toISOString();
    await db.query("select public.record_client_assessment($1,$2,$3,$4)", [
      ids.public,
      a.revision,
      stamp,
      result,
    ]);
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select public.record_client_assessment($1,$2,$3,$4) as ok",
          [ids.public, a.revision, stamp, result],
        )
      ).rows[0].ok,
      false,
    );
    const notifications = await db.query<{ recipient_id: string }>(
      "select recipient_id from public.notification_outbox where event_type='client.approved'",
    );
    assert.deepEqual(
      notifications.rows.map((r) => r.recipient_id),
      [ids.admin],
    );
    await as(db, "admin");
    const signal = await draft(db);
    await db.query("select public.transition_signal($1,'pending')", [signal]);
    await db.query("select public.transition_signal($1,'active')", [signal]);
    await db.query("select public.set_client_gate(true)");
    await as(db, "member");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select public.get_member_signal_summary()"),
      /Membership verification/,
    );
    await assert.rejects(
      db.query("select public.get_market_snapshot_before_client_gate()"),
      /permission denied/,
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      1,
    );
    await db.query("select public.get_member_signal_summary()");
    await as(db, "service_role");
    await db.query(
      "select public.record_client_assessment($1,$2,now()+interval '1 second',$3)",
      [
        ids.public,
        a.revision,
        { ...result, status: "revoked", reason: "inactive_7_days" },
      ],
    );
    await as(db, "public");
    assert.equal(
      (await db.query("select * from public.signals")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.client_access_events")).rows.length,
      0,
    );
    await as(db, "service_role");
    await assert.rejects(
      db.query(
        "select public.record_client_assessment($1,$2,now()+interval '2 seconds',$3)",
        [ids.public, a.revision, result],
      ),
      /Invalid assessment/,
    );
  } finally {
    await db.close();
  }
});
