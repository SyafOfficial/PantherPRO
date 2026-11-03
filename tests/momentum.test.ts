import { test } from "node:test";
import assert from "node:assert/strict";
import { rsiMomentum } from "../lib/momentum";
test("RSI zones have exact inclusive 70 and 30 boundaries", () => {
  assert.equal(rsiMomentum(70, "bullish").zone, "high");
  assert.equal(rsiMomentum(69.99, "bullish").zone, "normal");
  assert.equal(rsiMomentum(30, "bearish").zone, "low");
  assert.equal(rsiMomentum(30.01, "bearish").zone, "normal");
});
test("momentum distinguishes trend alignment from pullback and neutral bias", () => {
  assert.deepEqual(rsiMomentum(47.8, "bullish"), {
    zone: "normal",
    direction: "bearish",
    alignment: "against_bias",
  });
  assert.equal(rsiMomentum(65, "bullish").alignment, "aligned");
  assert.equal(rsiMomentum(50, "bullish").direction, "neutral");
  assert.equal(rsiMomentum(65, "mixed").alignment, "unconfirmed");
  assert.equal(rsiMomentum(0, "bearish").zone, "low");
  assert.equal(rsiMomentum(100, "bullish").zone, "high");
  assert.throws(() => rsiMomentum(NaN, "mixed"));
  assert.throws(() => rsiMomentum(101, "mixed"));
});
