import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientPushDetails } from "../lib/client-push";
import { notificationPayload } from "../lib/push";
const owner = "00000000-0000-4000-8000-000000000001";
const recipient = "00000000-0000-4000-8000-000000000002";
const revision = "00000000-0000-4000-8000-000000000003";
const delivery = {
  id: "delivery",
  outbox_id: "outbox",
  event_type: "client.approved",
  signal_id: null,
};
function fixture(
  event_key = `${owner}:client:approved:${revision}:${recipient}`,
) {
  let table = "";
  const calls: string[] = [];
  const db = {
    from(t: string) {
      table = t;
      calls.push(t);
      return this;
    },
    select(s: string) {
      calls.push(s);
      return this;
    },
    eq(k: string, v: string) {
      calls.push(`${k}:${v}`);
      return this;
    },
    async maybeSingle() {
      return {
        error: null,
        data:
          table === "notification_outbox"
            ? {
                event_key,
                recipient_id: recipient,
                event_type: "client.approved",
              }
            : { full_name: "Fixture Member", mt5_login: "123456" },
      };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}
test("client approval names the correct outbox subject with minimal fields", async () => {
  const { db, calls } = fixture();
  const client = await clientPushDetails(db, "outbox", "client.approved");
  assert.ok(calls.includes(`user_id:${owner}`));
  assert.ok(calls.includes("full_name,mt5_login"));
  const push = notificationPayload(delivery, null, client);
  assert.equal(push.title, "Client approved");
  assert.equal(push.body, "Fixture Member · MT5 123456\nMembership approved.");
  assert.equal(push.url, "/admin/clients");
});
test("malformed or recipient-mismatched client event cannot expose details", async () => {
  for (const key of [
    "invalid",
    `${owner}:client:approved:${revision}:${owner}`,
  ]) {
    const { db, calls } = fixture(key);
    await assert.rejects(clientPushDetails(db, "outbox", "client.approved"));
    assert.ok(!calls.includes("client_applications"));
  }
  const { db, calls } = fixture();
  assert.equal(await clientPushDetails(db, "outbox", "signal.active"), null);
  assert.deepEqual(calls, []);
});
test("client notification copy bounds names and strips control characters", () => {
  const p = notificationPayload(delivery, null, {
    full_name: "Fixture\nMember\u202e",
    mt5_login: "123456",
  });
  assert.equal(p.body, "Fixture Member · MT5 123456\nMembership approved.");
  assert.equal(
    notificationPayload(delivery).body,
    "A client was approved. Open your client directory.",
  );
});
