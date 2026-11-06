import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceFetch } from "../lib/service-fetch";
test("service mutation has a deadline and inherited cancellation, with no automatic replay", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const inherited = new AbortController();
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.ok(init?.signal);
    inherited.abort();
    assert.equal(init?.signal?.aborted, true);
    throw new Error("Unknown write outcome");
  };
  try {
    await assert.rejects(
      serviceFetch("https://project.example/rest/v1/rpc/ingest_mt5_snapshot", {
        method: "POST",
        signal: inherited.signal,
      }),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = saved;
  }
});
