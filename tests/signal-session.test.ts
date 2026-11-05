import { test } from "node:test";
import assert from "node:assert/strict";
import { signalSession, visibleDailyCount } from "../lib/signal-session";
const at = (time: string) => Date.parse(`2026-11-05T${time}+08:00`);
test("MYT signal session resets at 05:30 and opens a new counter at 06:00", () => {
  const before = signalSession(at("05:29:59"));
  assert.equal(
    new Date(before.start).toISOString(),
    "2026-11-03T22:00:00.000Z",
  );
  assert.equal(before.betweenSessions, false);
  assert.equal(signalSession(at("05:30:00")).betweenSessions, true);
  assert.equal(signalSession(at("05:59:59")).betweenSessions, true);
  const open = signalSession(at("06:00:00"));
  assert.equal(open.betweenSessions, false);
  assert.equal(new Date(open.start).toISOString(), "2026-11-04T22:00:00.000Z");
  assert.equal(new Date(open.reset).toISOString(), "2026-11-05T21:30:00.000Z");
  assert.equal(signalSession(at("23:59:59")).start, open.start);
});
test("a stale counter cannot carry yesterday's total past reset or into a new session", () => {
  const window = signalSession(at("05:29:59"));
  const summary = {
    count: 12,
    active_count: 2,
    session_start: new Date(window.start).toISOString(),
    session_reset: new Date(window.reset).toISOString(),
    as_of: new Date(at("05:29:59")).toISOString(),
  };
  assert.equal(visibleDailyCount(summary, at("05:29:59")), 12);
  assert.equal(visibleDailyCount(summary, at("05:30:00")), 0);
  assert.equal(visibleDailyCount(summary, at("06:00:00")), 0);
  assert.equal(visibleDailyCount(null, at("06:00:00")), null);
});
