import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { notificationPayload, type PushSignalDetails } from "../lib/push";
const delivery = {
  id: "delivery-test1",
  outbox_id: "event-test1",
  signal_id: "signal-test1",
  event_type: "signal.active",
};
const signal: PushSignalDetails = {
  direction: "BUY",
  entry: 3906,
  entry_low: 3905,
  entry_high: 3907,
  stop_loss: 3900,
  tp1: 3910,
  tp2: 3915,
  tp3: 3920,
};
test("entry push contains exact published range SL and all targets; invalid values are withheld", () => {
  const p = notificationPayload(delivery, signal);
  assert.equal(p.title, "Panther FX · XAUUSD BUY");
  assert.equal(
    p.body,
    "Entry: 3905.00 – 3907.00\nSL: 3900.00\nTP1: 3910.00\nTP2: 3915.00\nTP3: 3920.00",
  );
  assert.equal(
    notificationPayload(delivery, {
      ...signal,
      entry_low: null,
      entry_high: null,
    }).body.split("\n")[0],
    "Entry: 3906.00 – 3906.00",
  );
  assert.throws(() => notificationPayload(delivery, { ...signal, tp1: "NaN" }));
  assert.equal(
    notificationPayload(
      { ...delivery, event_type: "push.test" },
      signal,
    ).body.includes("3905"),
    false,
  );
});
test("device worker renders multiline entry prices and exact TP1 management text", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: Array<{ title: string; options: { body: string } }> = [];
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://pantherpro.onrender.com" },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
      registration: {
        showNotification: async (title: string, options: { body: string }) => {
          shown.push({ title, options });
        },
      },
    },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  vm.runInContext(
    "firstDelivery = async () => true; forgetDelivery = async () => {};",
    context,
  );
  async function push(payload: unknown) {
    let pending: Promise<unknown> | undefined;
    handlers.get("push")!({
      data: { json: () => payload },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  }
  await push(notificationPayload(delivery, signal));
  assert.equal(
    shown[0].options.body,
    notificationPayload(delivery, signal).body,
  );
  await push({
    ...notificationPayload(delivery),
    id: "delivery-test2",
    eventType: "signal.tp1",
  });
  assert.equal(shown[1].title, "HIT TP 1 Lads!");
  assert.equal(shown[1].options.body, "Collect half now and Set BE");
  await push({
    ...notificationPayload(delivery),
    id: "delivery-test3",
    eventType: "signal.tp2",
  });
  assert.equal(shown[2].title, "HIT TP 2 Lads!");
  assert.equal(shown[2].options.body, "Collect half now and Set BE");
  await push({
    ...notificationPayload(delivery),
    id: "delivery-test4",
    eventType: "signal.tp3",
  });
  assert.equal(shown[3].title, "HIT TP3!");
  assert.equal(shown[3].options.body, "CLOSE ALL NOW");
});
