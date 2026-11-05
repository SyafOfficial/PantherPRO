import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifiedIdentity } from "../lib/verified-identity";
const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const jwks = {
  keys: [
    {
      ...publicKey.export({ format: "jwk" }),
      kty: "EC",
      key_ops: ["verify"],
      kid: "test-signing-key",
      alg: "ES256",
      use: "sig",
    },
  ],
};
function token(extra: Record<string, unknown> = {}) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = encode({ alg: "ES256", kid: "test-signing-key", typ: "JWT" });
  const payload = encode({
    sub: "00000000-0000-4000-8000-000000000001",
    email: "member@example.test",
    role: "authenticated",
    aal: "aal1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    user_metadata: { role: "admin" },
    ...extra,
  });
  const body = `${head}.${payload}`;
  return `${body}.${sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
function database(
  jwt: string,
  profile: unknown = { role: "public", display_name: "Member" },
  fail = false,
) {
  let calls = 0;
  const client = createClient("https://project.example", "public-test-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input) => {
        const url = String(input);
        assert.match(url, /\/rest\/v1\/profiles/);
        calls++;
        return Response.json(
          fail
            ? { code: "XX000", message: "unavailable" }
            : (profile ?? { code: "PGRST116", message: "No rows" }),
          { status: fail ? 503 : profile ? 200 : 406 },
        );
      },
    },
  });
  return {
    db: {
      auth: { getClaims: () => client.auth.getClaims(jwt, { jwks }) },
      from: client.from.bind(client),
    } as unknown as SupabaseClient,
    calls: () => calls,
  };
}
test("verified signature avoids repeated Auth user lookup and editable metadata cannot grant admin", async () => {
  const { db, calls } = database(token());
  const result = await verifiedIdentity(db);
  assert.equal(result?.role, "public");
  assert.equal(result?.aal, "aal1");
  assert.equal(calls(), 1);
});
test("forged or expired sessions are rejected before profile access", async () => {
  for (const jwt of [
    token({ exp: 1 }),
    token().replace(/\.[^.]+$/, "." + Buffer.alloc(64).toString("base64url")),
  ]) {
    const { db, calls } = database(jwt);
    assert.equal(await verifiedIdentity(db), null);
    assert.equal(calls(), 0);
  }
});
test("admin role is read from the database and MFA comes only from verified claims", async () => {
  const a = database(token(), { role: "admin", display_name: "Admin" });
  assert.equal((await verifiedIdentity(a.db))?.aal, "aal1");
  const b = database(token({ aal: "aal2" }), {
    role: "admin",
    display_name: "Admin",
  });
  assert.equal((await verifiedIdentity(b.db))?.aal, "aal2");
  const missing = database(token(), null);
  assert.equal(await verifiedIdentity(missing.db), null);
  const failure = database(token(), null, true);
  await assert.rejects(
    verifiedIdentity(failure.db),
    /account could not be loaded/,
  );
});
