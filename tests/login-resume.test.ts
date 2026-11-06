import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const id = "00000000-0000-4000-8000-000000000001";
function jwt(exp: number) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${encode({ alg: "ES256", kid: "login-resume", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", aal: "aal2", exp })}`;
  return `${body}.${sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
async function check(reject: boolean) {
  const savedFetch = globalThis.fetch;
  const keys = [
    "APP_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ];
  const saved = keys.map((k) => process.env[k]);
  process.env.APP_MODE = "demo";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://loginresume.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-public-key";
  const expired = {
    access_token: jwt(1),
    refresh_token: "test-refresh",
    expires_at: 1,
    expires_in: 3600,
    token_type: "bearer",
    user: { id },
  };
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.ok(url.startsWith("https://loginresume.example/auth/v1/"));
    calls.push(url);
    if (url.includes("/token?"))
      return reject
        ? Response.json(
            {
              code: "refresh_token_not_found",
              message: "Invalid refresh token",
            },
            { status: 400 },
          )
        : Response.json({
            ...expired,
            access_token: jwt(Math.floor(Date.now() / 1000) + 3600),
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          });
    if (url.includes("/.well-known/jwks.json"))
      return Response.json({
        keys: [
          {
            ...publicKey.export({ format: "jwk" }),
            kid: "login-resume",
            alg: "ES256",
            use: "sig",
          },
        ],
      });
    throw new Error("Unexpected Auth operation");
  };
  try {
    const cookie = `sb-loginresume-auth-token=base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`;
    const response = await proxy(
      new NextRequest("https://app.example/login", { headers: { cookie } }),
    );
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.ok(calls.some((c) => c.includes("/token?")));
    assert.ok(response.headers.get("set-cookie"));
    if (!reject)
      assert.ok(
        response.headers
          .get("x-middleware-request-cookie")
          ?.includes("sb-loginresume-auth-token"),
      );
  } finally {
    globalThis.fetch = savedFetch;
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
}
test("login GET refreshes expired cookies and forwards renewed session without another password submission", () =>
  check(false));
test("invalid refresh token displays login instead of redirecting back to login repeatedly", () =>
  check(true));
