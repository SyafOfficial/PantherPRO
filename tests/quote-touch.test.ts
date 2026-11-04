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
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(
    await readFile(
      "supabase/proposals/quote_touch_monitor_and_priority_push.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile("supabase/proposals/signal_retention_30_days.sql", "utf8"),
  );
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

async function tracked(buy: boolean) {
  const db = await setup();
  await as(db, "admin");
  await db.query("select set_automatic_engine(true)");
  await as(db, "service_role");
  const base = Math.floor(Date.now() / 1000) - 15;
  const quote = (offset: number, bid: number, ask: number) => ({
    bid,
    ask,
    last_tick_time_raw: base + offset,
    last_tick_time_msc_raw: (base + offset) * 1000,
  });
  const put = async (
    offset: number,
    bid: number,
    ask: number,
    ticks?: ReturnType<typeof quote>[],
    m5Close?: number,
  ) => {
    const at = new Date((base + offset) * 1000).toISOString();
    const snapshot = {
      schema: "panther.mt5.snapshot.v1",
      provider: "Vestrado MT5",
      symbol: "XAUUSD.V",
      bar_time_basis: "broker_server",
      execution_enabled: false,
      exported_at_utc: at.slice(0, 19).replace(/-/g, ".").replace("T", " "),
      server_time_raw: base + offset,
      quote: quote(offset, bid, ask),
      series:
        m5Close == null
          ? []
          : [
              {
                timeframe: "M5",
                candles: [
                  { opened_at_server_raw: base + offset - 300, close: m5Close },
                ],
              },
            ],
      ask_m5:
        m5Close == null
          ? []
          : [{ opened_at_server_raw: base + offset - 300, close: m5Close }],
      ...(ticks ? { quote_ticks: ticks } : {}),
    };
    return db.query("select ingest_mt5_snapshot($1,$2,$3)", [
      snapshot,
      String(offset).padStart(64, "a"),
      at,
    ]);
  };
  await put(0, 100, 100.2);
  const id = (
    await db.query<{ id: string }>(
      "insert into signals(direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,reasoning,access,source,engine_version,source_event_id,source_fingerprint) values($1,100,99,101,$2,$3,$4,$5,'Quote touch regression test with explicit bid and ask observations.','public','mt5','vestrado-structure-v1',repeat('c',64),repeat('c',64)) returning id",
      [
        buy ? "BUY" : "SELL",
        buy ? 96 : 104,
        buy ? 105 : 95,
        buy ? 110 : 90,
        buy ? 120 : 80,
      ],
    )
  ).rows[0].id;
  await db.query(
    "update signals set status='active',published_at=now(),approved_by=$1 where id=$2",
    [ids.admin, id],
  );
  await db.query(
    "insert into automatic_engine_tracking(signal_id,last_snapshot,last_m5_open,last_tick_msc) values($1,$2,1,$3)",
    [id, new Date(base * 1000).toISOString(), base * 1000],
  );
  const events = async () =>
    (
      await db.query<{ event_type: string }>(
        "select event_type from notification_outbox where signal_id=$1 order by created_at,id",
        [id],
      )
    ).rows.map((x) => x.event_type);
  return { db, id, put, quote, events };
}
for (const buy of [true, false]) {
  test(`${buy ? "BUY" : "SELL"} SL touch alone stays active; exact M5 close triggers once`, async () => {
    const f = await tracked(buy);
    try {
      await f.put(1, buy ? 96.01 : 103.79, buy ? 96.21 : 103.99);
      assert.equal((await f.events()).includes("signal.stop_hit"), false);
      await f.put(2, buy ? 96 : 103.8, buy ? 96.2 : 104);
      assert.equal((await f.events()).includes("signal.stop_hit"), false);
      await f.put(3, 100, 100.2, undefined, buy ? 96 : 104);
      await f.put(3, 100, 100.2, undefined, buy ? 96 : 104);
      assert.deepEqual(await f.events(), ["signal.stop_hit"]);
      const row = (
        await f.db.query<{ status: string; outcome: null }>(
          "select status,outcome from signals where id=$1",
          [f.id],
        )
      ).rows[0];
      assert.equal(row.status, "closed");
      assert.equal(row.outcome, null);
    } finally {
      await f.db.close();
    }
  });
  test(`${buy ? "BUY" : "SELL"} TP1 TP2 TP3 exact opposite-side touches emit once without M5`, async () => {
    const f = await tracked(buy);
    try {
      for (const [i, target] of (buy
        ? [105, 110, 120]
        : [95, 90, 80]
      ).entries()) {
        await f.put(
          i + 1,
          buy ? target - 0.2 : target,
          buy ? target : target + 0.2,
        );
      }
      const events = await f.events();
      for (const name of [
        "signal.tp1",
        "signal.tp2",
        "signal.tp3",
        "signal.break_even",
      ])
        assert.equal(events.filter((x) => x === name).length, 1);
      assert.equal(events.includes("signal.stop_hit"), false);
    } finally {
      await f.db.close();
    }
  });
  test(`${buy ? "BUY" : "SELL"} buffered touch then retrace is observed atomically and overlap is deduplicated`, async () => {
    const f = await tracked(buy);
    try {
      const ticks = [
        f.quote(1, buy ? 104.8 : 95, buy ? 105 : 95.2),
        f.quote(2, 100, 100.2),
      ];
      await f.put(3, 100, 100.2, ticks);
      await f.put(4, 100, 100.2, ticks);
      const events = await f.events();
      for (const name of ["signal.tp1", "signal.break_even", "signal.be_hit"])
        assert.equal(events.filter((x) => x === name).length, 1);
      assert.equal(events.includes("signal.stop_hit"), false);
    } finally {
      await f.db.close();
    }
  });
}
test("a spread straddling the zone cannot falsely arm BE return", async () => {
  const f = await tracked(true);
  try {
    await f.db.exec("update signals set break_even=true");
    await f.put(1, 100.9, 101.1);
    await f.put(2, 100.9, 101.1);
    assert.equal((await f.events()).includes("signal.be_hit"), false);
    await f.put(3, 101.01, 101.21);
    await f.put(4, 101, 101.2);
    assert.equal(
      (await f.events()).filter((x) => x === "signal.be_hit").length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
