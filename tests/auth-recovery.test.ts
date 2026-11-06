import { test } from "node:test";
import assert from "node:assert/strict";
import { authRecovery } from "../lib/auth-recovery";

test("temporary auth outages and rate limits do not request a new sign-in", () => {
  for (const status of [undefined, 0, 408, 425, 429, 500, 502, 503, 504])
    assert.equal(authRecovery({ status }), "unavailable");
  assert.equal(authRecovery(null), null);
});
test("expired or rejected auth sessions go to sign-in instead of continuing workspace rendering", () => {
  for (const status of [400, 401, 403, 422])
    assert.equal(authRecovery({ status }), "sign_in");
});
