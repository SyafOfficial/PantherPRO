import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionDestination } from "../lib/session-destination";
import { verifiedIdentity } from "../lib/verified-identity";
import type { SupabaseClient } from "@supabase/supabase-js";

test("existing verified admin goes directly to admin while password-only session still needs MFA", () => {
  assert.equal(sessionDestination({ role: "admin", aal: "aal2" }), "/admin");
  assert.equal(
    sessionDestination({ role: "admin", aal: "aal1" }),
    "/account/security",
  );
  assert.equal(sessionDestination(null), "/login");
  assert.equal(
    sessionDestination({ role: "member", aal: "aal2" }),
    "/dashboard",
  );
});
test("resuming a signed-in session never submits another password or MFA challenge", async () => {
  const db = {
    auth: {
      async getClaims() {
        return {
          data: { claims: { sub: "verified-id", aal: "aal2" } },
          error: null,
        };
      },
    },
    from(table: string) {
      assert.equal(table, "profiles");
      return this;
    },
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async single() {
      return { data: { role: "admin", display_name: "Owner" }, error: null };
    },
  } as unknown as SupabaseClient;
  assert.equal(sessionDestination(await verifiedIdentity(db)), "/admin");
});
