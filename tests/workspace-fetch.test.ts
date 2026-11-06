import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceFetch } from "../lib/workspace-fetch";

test("workspace reads have a deadline and retain caller cancellation; mutations are not retried or shortened", async () => {
  const original = globalThis.fetch;
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    seen.push(init!);
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    await workspaceFetch("https://project.example/rest/v1/profiles");
    assert.ok(seen[0].signal);
    const caller = new AbortController();
    caller.abort();
    await workspaceFetch(
      "https://project.example/rest/v1/rpc/client_access_allowed",
      { method: "POST", signal: caller.signal },
    );
    assert.equal(seen[1].signal?.aborted, true);
    const write = { method: "POST", body: "{}" };
    await workspaceFetch(
      "https://project.example/rest/v1/rpc/ingest_mt5_snapshot",
      write,
    );
    assert.equal(seen[2], write);
    const unrelated = { method: "POST" };
    await workspaceFetch(
      "https://project.example/rest/v1/rpc/other_operation",
      unrelated,
    );
    assert.equal(seen[3], unrelated);
    assert.equal(seen.length, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test("a stalled workspace response body is aborted after headers arrive", async () => {
  const original = globalThis.fetch;
  const keepAlive = setInterval(() => {}, 1000);
  globalThis.fetch = (async (_input, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init!.signal!.addEventListener(
            "abort",
            () => controller.error(init!.signal!.reason),
            { once: true },
          );
        },
      }),
    )) as typeof fetch;
  try {
    const response = await workspaceFetch(
      "https://project.example/rest/v1/profiles",
      undefined,
      50,
    );
    await assert.rejects(
      response.text(),
      (error) => error instanceof Error && error.name === "TimeoutError",
    );
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = original;
  }
});
