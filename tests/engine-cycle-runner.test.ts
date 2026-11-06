import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEngineRunner } from "../lib/engine/cycle-runner";
function feed() {
  let stamp = "first";
  const fields: string[] = [];
  const db = {
    from() {
      return this;
    },
    select(v: string) {
      fields.push(v);
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return { data: { exported_at: stamp }, error: null };
    },
  } as unknown as SupabaseClient;
  return {
    db,
    fields,
    update: () => {
      stamp = "next";
    },
  };
}
test("unchanged export avoids repeated full scanning and every new export is still processed", async () => {
  const f = feed();
  let scans = 0;
  const run = createEngineRunner(f.db, async () => {
    scans++;
    return { available: true, published: 1 };
  });
  assert.equal((await run()).published, 1);
  assert.equal((await run()).reason, "already_processed");
  f.update();
  await run();
  assert.equal(scans, 2);
  assert.ok(f.fields.every((v) => v === "exported_at"));
});
test("failed and partially failed processing retries the same export; concurrent callers share work", async () => {
  const f = feed();
  let scans = 0;
  const run = createEngineRunner(f.db, async () => {
    scans++;
    if (scans === 1) throw new Error("Database down");
    return {
      available: true,
      tickVolumeState: scans === 2 ? "publication_unavailable" : "processed",
    };
  });
  await assert.rejects(run());
  await run();
  await Promise.all([run(), run()]);
  assert.equal(scans, 3);
  await run();
  assert.equal(scans, 3);
});
