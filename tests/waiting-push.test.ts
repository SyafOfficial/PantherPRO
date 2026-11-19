import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationPayload } from "../lib/push";
test("waiting, activated and cancelled notifications cannot claim a pending setup is a live trade", () => {
  const delivery = {
    id: "delivery",
    outbox_id: "event",
    event_type: "signal.waiting",
    signal_id: "signal",
  };
  const signal = {
    status: "pending",
    direction: "BUY",
    entry: 100,
    entry_low: 99,
    entry_high: 100,
    stop_loss: 97,
    tp1: 105,
    tp2: 110,
    tp3: 115,
  };
  const waiting = notificationPayload(delivery, signal);
  assert.match(waiting.title, /WAITING FOR ENTRY/);
  assert.match(waiting.body, /not active yet/);
  assert.match(waiting.body, /SL: 97.00/);
  const active = notificationPayload(
    { ...delivery, event_type: "signal.active" },
    { ...signal, status: "active" },
  );
  assert.doesNotMatch(active.title, /WAITING|Closed/);
  const stale = notificationPayload(delivery, { ...signal, status: "closed" });
  assert.match(stale.body, /Do not enter/);
  const cancelled = notificationPayload(
    { ...delivery, event_type: "signal.waiting_cancelled" },
    { ...signal, status: "closed" },
  );
  assert.match(cancelled.title, /cancelled.*no entry/);
  assert.match(cancelled.body, /No trade result/);
  assert.doesNotMatch(cancelled.title, /SL|TP/);
});
