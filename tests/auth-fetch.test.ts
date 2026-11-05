import { test } from "node:test";
import assert from "node:assert/strict";
import { authFetch } from "../lib/auth-fetch";
test("Auth transport retains caller cancellation without applying its timeout to unrelated RPCs", async () => {
  const original = globalThis.fetch;
  const caller = new AbortController();
  caller.abort();
  const options: RequestInit = { method: "POST", signal: caller.signal };
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    seen.push(init!);
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    await authFetch("https://project.example/auth/v1/token", options);
    assert.equal(seen[0].signal?.aborted, true);
    assert.equal(seen[0].method, "POST");
    await authFetch("https://project.example/rest/v1/rpc/report", options);
    assert.equal(seen[1], options);
  } finally {
    globalThis.fetch = original;
  }
});
