import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
async function fixture(showFails = false) {
  let pushHandler: (event: unknown) => void;
  const shown: string[] = [];
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://pantherpro.onrender.com" },
      addEventListener: (name: string, handler: typeof pushHandler) => {
        if (name === "push") pushHandler = handler;
      },
      registration: {
        showNotification: async (title: string) => {
          if (showFails) throw Error("display-rejected");
          shown.push(title);
        },
      },
    },
  });
  await vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  const push = async (url = "/dashboard") => {
    let pending: Promise<unknown> | undefined;
    pushHandler({
      data: {
        json: () => ({
          id: "diagnostic-test-01",
          eventType: "signal.active",
          url,
        }),
      },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  };
  return { context, shown, push };
}
test("unavailable IndexedDB cannot suppress a valid signal notification", async () => {
  const f = await fixture();
  await f.push();
  assert.equal(f.shown.length, 1);
});
test("known duplicates remain suppressed and invalid navigation is rejected before display", async () => {
  const f = await fixture();
  vm.runInContext("firstDelivery=async()=>false", f.context);
  await f.push();
  assert.equal(f.shown.length, 0);
  const invalid = await fixture();
  await invalid.push("https://example.net/");
  assert.equal(invalid.shown.length, 0);
});
test("display failure retains its original error even when storage cleanup is unavailable", async () => {
  const f = await fixture(true);
  await assert.rejects(f.push(), /display-rejected/);
});
