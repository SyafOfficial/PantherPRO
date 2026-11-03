import { test } from "node:test";
import assert from "node:assert/strict";
import { pricePips, priceDistance } from "../lib/engine/config";
test("gold uses ten pips per price dollar in both directions", () => {
  assert.equal(pricePips(3905, 3906), 10);
  assert.equal(pricePips(3905, 3910), 50);
  assert.equal(pricePips(3910, 3905), 50);
  assert.equal(pricePips(3906.93, 3904.93), 20);
  assert.equal(priceDistance(50), 5);
});
