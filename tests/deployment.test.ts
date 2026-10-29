import { test } from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import {
  publicOrigin,
  productionIssues,
  safeAuthNext,
} from "../lib/deployment";
import { validVapidPair } from "../lib/push-keys";
test("production rejects missing configuration and development limits request origins", () => {
  assert.ok(productionIssues({ APP_MODE: "production" }).length > 5);
  assert.deepEqual(productionIssues({ APP_MODE: "demo" }), []);
  assert.equal(
    publicOrigin({}, "http://127.0.0.1:3001"),
    "http://127.0.0.1:3001",
  );
  assert.equal(
    publicOrigin({}, "https://untrusted.example"),
    "http://localhost:3000",
  );
  for (const APP_ORIGIN of [
    "http://app.example",
    "https://user:pass@app.example",
    "https://app.example/path",
    "https://app.example?next=evil",
  ])
    assert.throws(() => publicOrigin({ APP_MODE: "production", APP_ORIGIN }));
  assert.equal(
    publicOrigin(
      { APP_MODE: "production", APP_ORIGIN: "https://app.example" },
      "https://untrusted.example",
    ),
    "https://app.example",
  );
});
test("recovery redirects allow only the fixed password page", () => {
  assert.equal(safeAuthNext("/account/password"), "/account/password");
  for (const value of [
    null,
    "https://untrusted.example",
    "//untrusted.example",
    "/admin",
    "/%2f%2funtrusted.example",
  ])
    assert.equal(safeAuthNext(value), "/");
});
test("VAPID readiness verifies the actual public/private pairing without printing keys", () => {
  const first = webpush.generateVAPIDKeys(),
    second = webpush.generateVAPIDKeys();
  assert.equal(validVapidPair(first.publicKey, first.privateKey), true);
  assert.equal(validVapidPair(first.publicKey, second.privateKey), false);
  assert.equal(validVapidPair("invalid", "invalid"), false);
  assert.equal(validVapidPair(undefined, undefined), false);
});

import { contentPolicy } from "../lib/content-policy";
test("production scripts require nonces while development retains debugging support", () => {
  const production = contentPolicy("abcdefghABCDEFGH12345678", false);
  const script = production
    .split(";")
    .find((v) => v.trim().startsWith("script-src"))!;
  assert.match(script, /nonce-abcdefghABCDEFGH12345678/);
  assert.match(script, /strict-dynamic/);
  assert.equal(script.includes("unsafe-inline"), false);
  assert.equal(script.includes("unsafe-eval"), false);
  assert.match(contentPolicy("abcdefghABCDEFGH12345678", true), /unsafe-eval/);
  assert.throws(() => contentPolicy("bad\nnonce", false));
});
