import { test } from "node:test";
import assert from "node:assert/strict";
import {
  webhookSchema,
  webhookFingerprint,
  validSecret,
  freshTimestamp,
  boundedJson,
} from "../lib/webhook";
import {
  safePushEndpoint,
  notificationPayload,
  retryDelay,
  subscriptionSchema,
} from "../lib/push";
const payload = {
  instrument: "XAUUSD",
  direction: "BUY",
  entry: 2000,
  stop_loss: 1990,
  tp1: 2010,
  tp2: 2020,
  tp3: 2030,
  reasoning: "A staging example with defined and ordered levels.",
  access: "public",
  secret: "a".repeat(32),
  event_id: "test-event-0001",
  timestamp: "2026-10-28T10:00:00Z",
};
test("webhook authenticates constant-length digests, bounds time and rejects extra data", () => {
  assert.equal(validSecret("a".repeat(32), "a".repeat(32)), true);
  assert.equal(validSecret("b".repeat(32), "a".repeat(32)), false);
  assert.equal(validSecret("", ""), false);
  assert.equal(
    freshTimestamp(payload.timestamp, Date.parse(payload.timestamp) + 299999),
    true,
  );
  assert.equal(
    freshTimestamp(payload.timestamp, Date.parse(payload.timestamp) + 300001),
    false,
  );
  assert.equal(freshTimestamp("invalid"), false);
  assert.equal(webhookSchema.safeParse(payload).success, true);
  assert.equal(
    webhookSchema.safeParse({ ...payload, role: "admin" }).success,
    false,
  );
  const first = webhookSchema.parse(payload);
  assert.equal(
    webhookFingerprint(first),
    webhookFingerprint({ ...first, secret: "b".repeat(32) }),
  );
  assert.notEqual(
    webhookFingerprint(first),
    webhookFingerprint({ ...first, tp3: 2040 }),
  );
});
test("streamed webhook body has an actual byte limit, not just a content-length check", async () => {
  const valid = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(
    ((await boundedJson(valid)) as typeof payload).event_id,
    payload.event_id,
  );
  const large = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '"' + "a".repeat(9000) + '"',
  });
  await assert.rejects(boundedJson(large), /body-too-large/);
  const invalid = new Request("https://example.test", {
    method: "POST",
    body: "{}",
  });
  await assert.rejects(boundedJson(invalid), /content-type/);
});
test("push rejects private hosts, lookalikes, credentials, ports and unsupported endpoints", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/Q/abc",
    "https://wns2.notify.windows.com/w/?token=x",
  ])
    assert.equal(safePushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://user@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8080/x",
    "https://example.test/x",
    "https://web.push.apple.com/x#bad",
  ])
    assert.equal(safePushEndpoint(endpoint), false, endpoint);
  assert.equal(
    subscriptionSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/x",
      keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
    }).success,
    true,
  );
});
test("push payloads use stable delivery IDs and expose no signal details", () => {
  const delivery = {
    id: "delivery-id",
    outbox_id: "event-id",
    event_type: "signal.active",
    signal_id: "signal-id",
  };
  const notification = notificationPayload(delivery);
  assert.equal(notification.id, delivery.id);
  assert.equal(notification.tag, "panther-delivery-id");
  assert.equal(notification.url, "/?view=Signals&signal=signal-id");
  assert.equal("entry" in notification, false);
  assert.equal(retryDelay(1), 30);
  assert.equal(retryDelay(5), 480);
});

import { classifyPushFailure } from "../lib/delivery";
test("push failure handling expires invalid devices and retries only transient failures", () => {
  for (const status of [404, 410])
    assert.equal(classifyPushFailure({ statusCode: status }).state, "expired");
  for (const status of [429, 500, 503])
    assert.equal(classifyPushFailure({ statusCode: status }).state, "retry");
  for (const status of [400, 401, 403, 413])
    assert.equal(classifyPushFailure({ statusCode: status }).state, "failed");
  assert.deepEqual(classifyPushFailure(new Error("transport failure")), {
    state: "retry",
    code: "transport_error",
  });
});

import { sameOriginMutation } from "../lib/request-security";
test("browser origin uses the real host behind Next bind addresses and rejects cross-origin writes", () => {
  const make = (origin: string, host = "terminal.example", proto = "https") =>
    new Request("http://0.0.0.0:3000/api/notifications/test", {
      headers: { origin, host, "x-forwarded-proto": proto },
    });
  assert.equal(sameOriginMutation(make("https://terminal.example")), true);
  assert.equal(
    sameOriginMutation(make("http://127.0.0.1:3000", "127.0.0.1:3000", "http")),
    true,
  );
  for (const origin of [
    "https://evil.example",
    "null",
    "https://terminal.example.evil.test",
    "http://terminal.example",
    "https://terminal.example/path",
    "",
  ])
    assert.equal(sameOriginMutation(make(origin)), false, origin);
});
