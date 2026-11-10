import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const context = vm.createContext({
    URL,
    Response,
    self: {
      skipWaiting: () => {},
      clients: { claim: async () => {} },
      addEventListener: (name: string, fn: any) => handlers.set(name, fn),
    },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  return { handlers };
}

test("installed app leaves navigation and API requests to the browser", async () => {
  const { handlers } = await worker();
  assert.equal(handlers.has("fetch"), false);
  assert.equal(handlers.has("push"), true);
  assert.equal(handlers.has("notificationclick"), true);
});

test("installed app does not intercept slow navigation or password form POST", async () => {
  const { handlers } = await worker();
  assert.equal(handlers.has("fetch"), false);
});
