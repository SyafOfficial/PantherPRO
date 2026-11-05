import { test } from "node:test";
import assert from "node:assert/strict";
import { performanceRange } from "../lib/performance";
test("admin date ranges use inclusive MYT calendar dates and reject invalid or excessive ranges", () => {
  assert.deepEqual(performanceRange("2026-11-01", "2026-11-05"), {
    from: "2026-11-01",
    to: "2026-11-05",
    fromTime: "2026-10-31T16:00:00.000Z",
    toTime: "2026-11-05T16:00:00.000Z",
  });
  assert.throws(() => performanceRange("2026-02-31", "2026-03-05"));
  assert.throws(() => performanceRange("2026-11-05", "2026-11-01"));
  assert.throws(() => performanceRange("2024-01-01", "2026-01-01"));
  assert.equal(
    performanceRange(undefined, undefined, Date.parse("2026-11-04T17:00:00Z"))
      .to,
    "2026-11-05",
  );
});
