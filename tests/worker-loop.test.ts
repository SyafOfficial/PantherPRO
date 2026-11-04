import { test } from "node:test";
import assert from "node:assert/strict";
import { forEachConcurrent, runWorkerLoop } from "../lib/worker-loop";
import { monitorAcceptedSnapshot } from "../lib/engine/monitor";
import type { SupabaseClient } from "@supabase/supabase-js";
test("slow background work does not hold delivery; each loop has at most one task in flight", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const options = {
    idleMs: 0,
    once: true,
    stopped: () => false,
    onError: () => assert.fail("unexpected error"),
  };
  const background = runWorkerLoop(async () => {
    order.push("background");
    await blocked;
    order.push("background-done");
  }, options);
  await runWorkerLoop(async () => {
    order.push("push");
  }, options);
  assert.deepEqual(order, ["background", "push"]);
  release();
  await background;
});
test("concurrent fanout starts other devices while one is slow, bounded to five and all attempted on failure", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    peak = 0;
  const started: number[] = [];
  const pending = forEachConcurrent([0, 1, 2, 3, 4, 5, 6], 5, async (n) => {
    started.push(n);
    active++;
    peak = Math.max(peak, active);
    try {
      if (n === 0) await blocked;
      if (n === 2) throw new Error("slow endpoint");
    } finally {
      active--;
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 7);
  assert.ok(peak <= 5);
  release();
  await assert.rejects(pending);
});
test("accepted quote monitoring can only update existing signals, with no publication plans", async () => {
  const calls: unknown[] = [];
  const db = {
    rpc: async (...args: unknown[]) => {
      calls.push(args);
      return { error: null };
    },
  } as unknown as SupabaseClient;
  await monitorAcceptedSnapshot(db, "2026-11-04T05:00:00Z");
  assert.deepEqual(calls, [
    [
      "apply_automatic_engine",
      { export_time: "2026-11-04T05:00:00Z", plans: [] },
    ],
  ]);
});
