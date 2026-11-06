import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forEachConcurrent,
  runWorkerLoop,
  createTaskPool,
} from "../lib/worker-loop";
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
test("a slow device does not block a new delivery when another slot is released", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pool = createTaskPool(2, () => assert.fail("Unexpected task failure"));
  const order: string[] = [];
  pool.start(async () => {
    order.push("slow");
    await blocked;
    order.push("slow-done");
  });
  pool.start(async () => {
    order.push("first-fast");
  });
  assert.equal(pool.available, 0);
  assert.throws(() => pool.start(async () => {}), /capacity/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.available, 1);
  pool.start(async () => {
    order.push("next-event");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["slow", "first-fast", "next-event"]);
  let drained = false;
  const done = pool.drain().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  release();
  await done;
  assert.equal(pool.available, 2);
});
test("failed sends release capacity for later events and are reported once", async () => {
  let failures = 0;
  const pool = createTaskPool(1, () => {
    failures++;
  });
  pool.start(async () => {
    throw new Error("Endpoint unavailable");
  });
  await pool.drain();
  assert.equal(failures, 1);
  assert.equal(pool.available, 1);
  let sent = false;
  pool.start(async () => {
    sent = true;
  });
  await pool.drain();
  assert.equal(sent, true);
});

test("backend failures back off progressively and success restores the normal polling rate", async () => {
  const delays: number[] = [];
  let call = 0;
  await runWorkerLoop(
    async () => {
      call++;
      if (call <= 6 || call === 8) throw new Error("Database unavailable");
    },
    {
      idleMs: 250,
      once: false,
      stopped: () => call >= 9,
      onError: () => {},
      wait: async (ms) => {
        delays.push(ms);
      },
    },
  );
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 250, 1000]);
});
