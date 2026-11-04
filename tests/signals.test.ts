import { test } from "node:test";
import assert from "node:assert/strict";
import { signalSchema, canTransition } from "../lib/signals";
const buy = {
  instrument: "XAUUSD",
  direction: "BUY",
  entry: 2000,
  stop_loss: 1990,
  tp1: 2010,
  tp2: 2020,
  tp3: 2030,
  reasoning: "Illustrative support retest with a defined risk boundary.",
  access: "public",
};
test("accepts ordered BUY and SELL setups", () => {
  assert.equal(signalSchema.safeParse(buy).success, true);
  assert.equal(
    signalSchema.safeParse({
      ...buy,
      direction: "SELL",
      stop_loss: 2010,
      tp1: 1990,
      tp2: 1980,
      tp3: 1970,
    }).success,
    true,
  );
});
test("rejects mismatched stops, unordered targets, empty reasoning and non-finite prices", () => {
  for (const changes of [
    { stop_loss: 2010 },
    { tp2: 2005 },
    { reasoning: "short" },
    { entry: Infinity },
    { instrument: "BTCUSD" },
    { access: "admin" },
    { entry: -1 },
  ])
    assert.equal(signalSchema.safeParse({ ...buy, ...changes }).success, false);
});
test("signals have one member audience and reject retired membership tiers", () => {
  assert.equal(
    signalSchema.safeParse({ ...buy, access: "vip" }).success,
    false,
  );
  assert.equal(signalSchema.safeParse(buy).success, true);
});

test("review is required; closed signals cannot reopen", () => {
  assert.equal(canTransition("draft", "active"), false);
  assert.equal(canTransition("draft", "pending"), true);
  assert.equal(canTransition("pending", "active"), true);
  assert.equal(canTransition("active", "closed"), true);
  assert.equal(canTransition("closed", "active"), false);
  assert.equal(canTransition("missing", "active"), false);
});
