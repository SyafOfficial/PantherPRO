import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dashboardAccess } from "../lib/clients/dashboard-access";

function fixture(status: string | null, allowed = true, error: unknown = null) {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      calls.push(table);
      return this;
    },
    select(fields: string) {
      calls.push(fields);
      return this;
    },
    eq(field: string, value: string) {
      calls.push(`${field}:${value}`);
      return this;
    },
    async maybeSingle() {
      return { data: status ? { status } : null, error };
    },
    async rpc(name: string) {
      calls.push(name);
      return { data: allowed, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}
const client = { id: "verified-owner", role: "member" };
test("dashboard denies missing, pending and revoked applications even if legacy access is allowed", async () => {
  for (const status of [null, "pending", "revoked", "rejected"]) {
    const { db, calls } = fixture(status);
    assert.equal(await dashboardAccess(db, client), false);
    assert.ok(calls.includes("user_id:verified-owner"));
    assert.ok(!calls.includes("client_access_allowed"));
  }
});
test("approved dashboard still requires current server access and accepts manual approval", async () => {
  const yes = fixture("approved");
  assert.equal(await dashboardAccess(yes.db, client), true);
  assert.ok(yes.calls.includes("client_access_allowed"));
  assert.equal(
    await dashboardAccess(fixture("approved", false).db, client),
    false,
  );
});
test("lookup outages fail closed and admin access uses the verified server role", async () => {
  await assert.rejects(
    dashboardAccess(fixture(null, true, { code: "timeout" }).db, client),
  );
  const admin = fixture(null);
  assert.equal(
    await dashboardAccess(admin.db, { ...client, role: "admin" }),
    true,
  );
  assert.deepEqual(admin.calls, []);
});
