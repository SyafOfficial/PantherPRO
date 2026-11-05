import { test } from "node:test";
import assert from "node:assert/strict";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../proxy";
test("HMAC bridge bypasses session proxy while account and admin requests retain it", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
  assert.equal(matches("/api/bridge/mt5"), false);
  assert.equal(matches("/api/bridge/mt5?test=1"), false);
  assert.equal(matches("/api/bridge/mt5/"), false);
  for (const path of [
    "/account",
    "/admin",
    "/api/push/subscriptions",
    "/api/market/mt5",
    "/api/bridge/mt5-other",
    "/api/bridge/mt5/admin",
  ])
    assert.equal(matches(path), true, path);
});
