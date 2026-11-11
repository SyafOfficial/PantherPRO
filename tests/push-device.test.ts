import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPushDevice } from "../lib/push-device";
function fixture(
  options: {
    deleteFails?: boolean;
    unsubscribeFails?: boolean;
    postFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const old = {
    endpoint: "https://web.push.apple.com/old",
    unsubscribe: async () => {
      calls.push("unsubscribe");
      return !options.unsubscribeFails;
    },
    toJSON: () => ({ keys: { p256dh: "old", auth: "old" } }),
  };
  const fresh = {
    endpoint: "https://web.push.apple.com/new",
    toJSON: () => ({ keys: { p256dh: "new", auth: "new" } }),
  };
  const registration = {
    pushManager: {
      getSubscription: async () => old,
      subscribe: async () => {
        calls.push("subscribe");
        return fresh;
      },
    },
  } as unknown as ServiceWorkerRegistration;
  const fetcher = (async (_url, init) => {
    const method = init?.method ?? "";
    const body = JSON.parse(String(init?.body));
    calls.push(method + ":" + body.endpoint);
    return new Response("{}", {
      status:
        (method === "DELETE" && options.deleteFails) ||
        (method === "POST" && options.postFails)
          ? 400
          : 200,
    });
  }) as typeof fetch;
  return { calls, registration, fetcher };
}
test("reconnect unregisters only this endpoint, creates a fresh subscription and saves its new keys", async () => {
  const f = fixture();
  await registerPushDevice(
    f.registration,
    new Uint8Array([1]),
    true,
    f.fetcher,
  );
  assert.deepEqual(f.calls, [
    "DELETE:https://web.push.apple.com/old",
    "unsubscribe",
    "subscribe",
    "POST:https://web.push.apple.com/new",
  ]);
});
test("normal enable preserves a valid subscription; reconnect failures never claim success or recycle the old endpoint", async () => {
  const normal = fixture();
  await registerPushDevice(
    normal.registration,
    new Uint8Array([1]),
    false,
    normal.fetcher,
  );
  assert.deepEqual(normal.calls, ["POST:https://web.push.apple.com/old"]);
  const badDelete = fixture({ deleteFails: true });
  await assert.rejects(
    registerPushDevice(
      badDelete.registration,
      new Uint8Array([1]),
      true,
      badDelete.fetcher,
    ),
    /could not be reconnected/,
  );
  assert.equal(badDelete.calls.length, 1);
  const badBrowser = fixture({ unsubscribeFails: true });
  await assert.rejects(
    registerPushDevice(
      badBrowser.registration,
      new Uint8Array([1]),
      true,
      badBrowser.fetcher,
    ),
    /could not renew/,
  );
  assert.equal(badBrowser.calls.includes("subscribe"), false);
  const badSave = fixture({ postFails: true });
  await assert.rejects(
    registerPushDevice(
      badSave.registration,
      new Uint8Array([1]),
      true,
      badSave.fetcher,
    ),
    /registration failed/,
  );
});
