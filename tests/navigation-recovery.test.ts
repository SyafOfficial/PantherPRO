import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
async function worker(fetcher: typeof fetch) {
  const handlers = new Map<string, (event: any) => void>();
  let deadline = () => {};
  const context = vm.createContext({
    URL,
    Response,
    AbortController,
    fetch: fetcher,
    setTimeout: (fn: () => void, ms: number) => {
      assert.equal(ms, 45000);
      deadline = fn;
      return 1;
    },
    clearTimeout: () => {},
    self: {
      addEventListener: (name: string, fn: any) => handlers.set(name, fn),
    },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  const navigate = (url = "https://app.example/?signal=abc") => {
    let result: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request: { url, mode: "navigate", method: "GET" },
      respondWith: (r: Promise<Response>) => {
        result = r;
      },
    });
    return result!;
  };
  return { navigate, expire: () => deadline(), handlers };
}
test("installed app navigation returns live responses and never intercepts API data", async () => {
  const response = new Response("private live response");
  const w = await worker((async (_request, options) => {
    assert.equal(options?.cache, "no-store");
    return response;
  }) as typeof fetch);
  assert.equal(await w.navigate(), response);
  let intercepted = false;
  w.handlers.get("fetch")!({
    request: { mode: "cors", url: "https://app.example/api/market/mt5" },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
});
test("installed app slow navigation resolves to a dark noncached Retry screen within its deadline", async () => {
  const w = await worker((() => new Promise(() => {})) as typeof fetch);
  const pending = w.navigate("https://app.example/?signal=%22%3E&next=1");
  w.expire();
  const r = await pending;
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const html = await r.text();
  assert.match(html, /background:#090a0f/);
  assert.match(html, /Retry/);
  assert.match(html, /&amp;next=1/);
  assert.doesNotMatch(html, /<script/);
});
test("installed app network and server failures provide recovery without showing market data", async () => {
  for (const fetcher of [
    async () => {
      throw Error("offline");
    },
    async () => new Response("upstream failure", { status: 502 }),
  ]) {
    const w = await worker(fetcher as typeof fetch);
    const r = await w.navigate();
    assert.equal(r.status, 503);
    const html = await r.text();
    assert.match(html, /Retry/);
    assert.doesNotMatch(html, /upstream failure/);
  }
});

test("installed app never cancels or replaces a password form POST", async () => {
  const w = await worker((async () => {
    throw Error("must not intercept POST");
  }) as typeof fetch);
  let intercepted = false;
  w.handlers.get("fetch")!({
    request: {
      mode: "navigate",
      method: "POST",
      url: "https://app.example/login",
    },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
});
