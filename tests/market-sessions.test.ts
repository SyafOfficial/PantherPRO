import { test } from "node:test";
import assert from "node:assert/strict";
import { marketSessions, sessionCountdown } from "../lib/market-sessions";
const session = (at: string, name: string) =>
  marketSessions(Date.parse(at)).find((s) => s.name === name)!;
const iso = (value: number) => new Date(value).toISOString();

test("Tokyo opens at 08:00 MYT and closes at 17:00 MYT with exact boundaries", () => {
  assert.equal(session("2026-11-06T00:00:00Z", "Tokyo").open, true);
  assert.equal(session("2026-11-06T08:59:59Z", "Tokyo").open, true);
  const closed = session("2026-11-06T09:00:00Z", "Tokyo");
  assert.equal(closed.open, false);
  assert.equal(iso(closed.start), "2026-11-09T00:00:00.000Z");
});

test("London and New York follow their own DST calendars including transition mismatches", () => {
  for (const [at, london, newYork] of [
    ["2026-01-06T14:00:00Z", "08:00", "13:00"],
    ["2026-07-07T14:00:00Z", "07:00", "12:00"],
    ["2026-03-16T14:00:00Z", "08:00", "12:00"],
    ["2026-10-26T14:00:00Z", "08:00", "12:00"],
  ]) {
    assert.equal(iso(session(at, "London").start).slice(11, 16), london);
    assert.equal(iso(session(at, "New York").start).slice(11, 16), newYork);
  }
});

test("Sydney uses southern-hemisphere DST rather than London or New York offsets", () => {
  assert.equal(
    iso(session("2026-01-05T00:00:00Z", "Sydney").start),
    "2026-01-04T21:00:00.000Z",
  );
  assert.equal(
    iso(session("2026-07-06T00:00:00Z", "Sydney").start),
    "2026-07-05T22:00:00.000Z",
  );
});

test("a Friday New York session remains open across MYT midnight and all sessions close for the weekend", () => {
  assert.equal(session("2026-11-06T21:59:59Z", "New York").open, true);
  const closed = session("2026-11-06T22:00:00Z", "New York");
  assert.equal(closed.open, false);
  assert.equal(iso(closed.start), "2026-11-09T13:00:00.000Z");
  for (const s of marketSessions(Date.parse("2026-11-07T12:00:00Z"))) {
    assert.equal(s.open, false);
    assert.ok(s.start > Date.parse("2026-11-07T12:00:00Z"));
  }
});

test("overlap follows the schedule and countdown never becomes negative", () => {
  assert.deepEqual(
    marketSessions(Date.parse("2026-11-06T13:30:00Z"))
      .filter((s) => s.open)
      .map((s) => s.name),
    ["London", "New York"],
  );
  assert.equal(sessionCountdown(-100), "00h 00m 00s");
  assert.equal(sessionCountdown(3661000), "01h 01m 01s");
  assert.equal(sessionCountdown(2 * 86400000 + 3600000), "2d 01h 00m");
  assert.throws(() => marketSessions(NaN));
});
