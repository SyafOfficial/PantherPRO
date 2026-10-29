import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quoteSchema,
  calendarEventSchema,
  quoteFreshness,
  malaysiaTime,
} from "../lib/market-data";
const fixture = {
  provider_id: "00000000-0000-4000-8000-000000000099",
  reference: "fictional-quote",
  instrument: "XAUUSD",
  bid: 2000,
  ask: 2001,
  observed_at: "2026-10-28T00:00:00Z",
};
test("normalized quotes reject inverted spreads, missing provenance and extra keys", () => {
  assert.equal(quoteSchema.safeParse(fixture).success, true);
  for (const changes of [
    { bid: 2002 },
    { ask: Infinity },
    { bid: 0 },
    { reference: "" },
    { provider_id: "unknown" },
    { instrument: "EURUSD" },
    { secret: "unexpected" },
  ])
    assert.equal(
      quoteSchema.safeParse({ ...fixture, ...changes }).success,
      false,
    );
});
test("freshness ages from the source timestamp and receipt time, not render time", () => {
  const quote = {
    ...fixture,
    received_at: fixture.observed_at,
    max_gap_seconds: 60,
  };
  const base = Date.parse(fixture.observed_at);
  assert.equal(quoteFreshness(quote, base + 59999), true);
  assert.equal(quoteFreshness(quote, base + 60001), false);
  assert.equal(
    quoteFreshness({ ...quote, observed_at: "invalid" }, base),
    false,
  );
  assert.equal(
    quoteFreshness(
      { ...quote, observed_at: new Date(base + 6000).toISOString() },
      base,
    ),
    false,
  );
});
test("calendar keeps missing figures null and only accepts attributable HTTPS sources", () => {
  const event = {
    provider_id: fixture.provider_id,
    reference: "fixture-event",
    name: "FICTIONAL TEST RELEASE",
    country: "United States",
    currency: "USD",
    event_time: fixture.observed_at,
    previous: null,
    forecast: null,
    actual: null,
    importance: "high",
    source_updated_at: fixture.observed_at,
    source_url: "https://example.test/fixture",
  };
  assert.equal(calendarEventSchema.safeParse(event).success, true);
  assert.equal(
    calendarEventSchema.safeParse({ ...event, actual: "   " }).success,
    false,
  );
  for (const source_url of [
    "javascript:alert(1)",
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test:8080",
  ])
    assert.equal(
      calendarEventSchema.safeParse({ ...event, source_url }).success,
      false,
    );
  assert.match(malaysiaTime("2026-10-28T00:00:00Z"), /8:00/);
});
