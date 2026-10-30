import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseForexFactory,
  forexFactoryCalendar,
  FOREX_FACTORY_FEED,
} from "../lib/forex-factory";
const row = {
  title: "Non-Farm Employment Change",
  country: "USD",
  date: "2026-10-30T08:30:00-04:00",
  impact: "High",
  forecast: "100K",
  previous: "90K",
};
test("Forex Factory adapter preserves supplied figures, converts offsets and never invents actuals", () => {
  const events = parseForexFactory([row, row, { ...row, country: "EUR" }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_time, "2026-10-30T12:30:00.000Z");
  assert.equal(events[0].forecast, "100K");
  assert.equal(events[0].actual, null);
  assert.equal(events[0].importance, "high");
  assert.equal(
    parseForexFactory([{ ...row, actual: "120K" }])[0].actual,
    "120K",
  );
});
test("ambiguous dates and malformed upstream responses cannot become calendar facts", () => {
  assert.throws(() => parseForexFactory({ events: [row] }));
  assert.throws(() =>
    parseForexFactory([{ ...row, date: "2026-10-30T08:30:00" }]),
  );
  assert.throws(() =>
    parseForexFactory([{ ...row, impact: "Guaranteed bullish" }]),
  );
  assert.deepEqual(parseForexFactory([]), []);
});
test("fixed upstream fetch reports failures instead of generating replacement data", async () => {
  const fetcher = (async (url, options) => {
    assert.equal(url, FOREX_FACTORY_FEED);
    assert.equal(options?.redirect, "error");
    return new Response(JSON.stringify([row]));
  }) as typeof fetch;
  const result = await forexFactoryCalendar(fetcher, 1793363400000);
  assert.equal(result.source_name, "Forex Factory");
  assert.equal(result.refresh_seconds, 3600);
  assert.equal(result.events.length, 1);
  await assert.rejects(() =>
    forexFactoryCalendar(
      (async () =>
        new Response("Unavailable", { status: 429 })) as typeof fetch,
    ),
  );
});
