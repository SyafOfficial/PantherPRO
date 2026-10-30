import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNews, newsProfile, newsRisk } from "../lib/news-context";
import { parseFedRate, compareFedRates } from "../lib/intelligence/fed-rates";
import {
  fundamentalAnalysis,
  buildIntelligence,
} from "../lib/intelligence/engine";
import { signalSchema } from "../lib/signals";
import { webhookSchema, webhookFingerprint } from "../lib/webhook";
import type { CalendarEvent } from "../lib/market-data";
const now = Date.parse("2026-10-29T10:00:00Z");
function event(
  name: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: "00000000-0000-4000-8000-000000000077",
    provider_id: "00000000-0000-4000-8000-000000000099",
    reference: "FICTIONAL-NEWS-TEST",
    name,
    country: "United States",
    currency: "USD",
    event_time: new Date(now - 60000).toISOString(),
    previous: null,
    forecast: "2.0%",
    actual: "2.1%",
    importance: "high",
    source_updated_at: new Date(now - 30000).toISOString(),
    source_url: "https://example.test/fixture",
    source_name: "FICTIONAL TEST SOURCE",
    received_at: new Date(now - 10000).toISOString(),
    version: 1,
    ...overrides,
  };
}
test("XAUUSD coverage distinguishes Fed decisions, FOMC communications and the requested releases", () => {
  for (const [name, kind] of [
    ["Fed Interest Rate Decision", "fed_rate"],
    ["Federal Funds Rate", "fed_rate"],
    ["FOMC Interest Rate Decision", "fed_rate"],
    ["FOMC Meeting Minutes", "fomc"],
    ["FOMC Press Conference", "fomc"],
    ["Non-Farm Payrolls", "nfp"],
    ["US NFP", "nfp"],
    ["Core CPI (MoM)", "cpi"],
    ["Producer Price Index", "ppi"],
    ["Core PPI (YoY)", "ppi"],
    ["ISM Services PMI", "pmi"],
    ["S&P Global Manufacturing PMI", "pmi"],
  ])
    assert.equal(classifyNews(name), kind, name);
  for (const name of [
    "Nonfarm Productivity",
    "ADP Employment Change",
    "ISM Manufacturing Prices",
    "ISM Services Employment",
    "Federal Funds Futures",
  ])
    assert.equal(classifyNews(name), "other", name);
  assert.match(newsProfile("Core PPI").above, /not pass through mechanically/);
  assert.match(newsProfile("NFP").above, /unemployment, wages/);
});
test("Fed target ranges compare matching conventions in basis points without making up bounds", () => {
  const actual = parseFedRate("4.25% – 4.50%")!,
    forecast = parseFedRate("4.50-4.75%")!;
  assert.deepEqual(compareFedRates(actual, forecast), {
    comparison: "below",
    lower_bps: -25,
    upper_bps: -25,
  });
  assert.equal(compareFedRates(actual, parseFedRate("4.50%")!), null);
  for (const value of [null, "4.5", "unknown", "4.75%-4.25%", "101%", "-1%"])
    assert.equal(parseFedRate(value), null);
});
test("an expected Fed cut differs from a hold above consensus", () => {
  const cut = fundamentalAnalysis(
    event("Fed Interest Rate Decision", {
      previous: "4.50-4.75%",
      forecast: "4.25-4.50%",
      actual: "4.25-4.50%",
    }),
    "post_news",
    now,
  );
  assert.equal(cut.bias, "neutral");
  assert.equal(cut.metrics.policy_decision, "cut");
  assert.equal(cut.metrics.comparison, "in_line");
  assert.equal(cut.metrics.policy_change_lower_bps, -25);
  assert.equal(cut.metrics.surprise_lower_bps, 0);
  const hold = fundamentalAnalysis(
    event("Federal Funds Rate", {
      previous: "4.50%",
      forecast: "4.25%",
      actual: "4.50%",
    }),
    "post_news",
    now,
  );
  assert.equal(hold.metrics.policy_decision, "hold");
  assert.equal(hold.metrics.comparison, "above");
  assert.equal(hold.metrics.surprise_upper_bps, 25);
  assert.equal(hold.bias, "neutral");
  const incompatible = fundamentalAnalysis(
    event("Federal Funds Rate", { forecast: "4.25-4.50%", actual: "4.50%" }),
    "post_news",
    now,
  );
  assert.equal(incompatible.bias, "insufficient_data");
});
test("FOMC communication is hypothetical before release and requires verified text afterward", () => {
  const pre = fundamentalAnalysis(
    event("FOMC Meeting Minutes", {
      forecast: null,
      actual: null,
      event_time: new Date(now + 600000).toISOString(),
    }),
    "pre_news",
    now,
  );
  assert.equal(pre.bias, "neutral");
  assert.equal(pre.scenarios.length, 3);
  assert.match(pre.summary, /Hypothetical/);
  assert.equal(pre.metrics.actual, null);
  const post = fundamentalAnalysis(
    event("FOMC Press Conference", { forecast: null, actual: null }),
    "post_news",
    now,
  );
  assert.equal(post.bias, "insufficient_data");
  assert.match(post.summary, /calendar row alone/);
});
test("PMI consensus surprise is separate from the 50 activity threshold", () => {
  const contracting = fundamentalAnalysis(
    event("ISM Manufacturing PMI", { forecast: "47", actual: "48" }),
    "post_news",
    now,
  );
  assert.equal(contracting.metrics.comparison, "above");
  assert.equal(contracting.metrics.activity_regime, "below_50_contraction");
  assert.equal(contracting.bias, "neutral");
  const expanding = fundamentalAnalysis(
    event("S&P Global Services PMI", { forecast: "52", actual: "51" }),
    "post_news",
    now,
  );
  assert.equal(expanding.metrics.comparison, "below");
  assert.equal(expanding.metrics.activity_regime, "above_50_expansion");
  assert.equal(
    fundamentalAnalysis(
      event("ISM Manufacturing PMI", { forecast: "47%", actual: "48%" }),
      "post_news",
      now,
    ).bias,
    "insufficient_data",
  );
});
test("signal news watch checks the whole supplied calendar and never claims missing news is safe", () => {
  assert.equal(newsRisk([], now).state, "unavailable");
  const unrelated = Array.from({ length: 5 }, (_, i) =>
    event("Other fixture", {
      id: `fixture-${i}`,
      importance: "low",
      event_time: new Date(now + (i + 1) * 60000).toISOString(),
      actual: null,
    }),
  );
  const nfp = event("NFP", {
    id: "fixture-nfp",
    event_time: new Date(now + 30 * 60000).toISOString(),
    actual: null,
  });
  const reports = buildIntelligence({
    quotes: [],
    events: [...unrelated, nfp],
    as_of: new Date(now).toISOString(),
  });
  assert.ok(
    reports.technical.limitations.some((l) => l.includes("watched US release")),
  );
  assert.equal(newsRisk([nfp], now).state, "scheduled");
  assert.equal(
    newsRisk([{ ...nfp, event_time: new Date(now - 60000).toISOString() }], now)
      .state,
    "release_window",
  );
  assert.equal(
    newsRisk([{ ...nfp, source_updated_at: "2020-01-01T00:00:00Z" }], now)
      .source_freshness_unverified,
    true,
  );
});
test("methods and higher timeframes validate without inventing strategy detections", () => {
  const setup = {
    instrument: "XAUUSD",
    direction: "BUY",
    entry: 2000,
    stop_loss: 1990,
    tp1: 2010,
    tp2: 2020,
    tp3: 2030,
    reasoning: "A fictional setup for method metadata validation.",
    access: "public",
    strategy: "BOS",
    timeframe: "M30",
    higher_timeframe: "H4",
  };
  assert.equal(signalSchema.safeParse(setup).success, true);
  for (const changed of [
    { strategy: "OTHER" },
    { timeframe: "M5" },
    { higher_timeframe: "M30" },
    { timeframe: null },
    { timeframe: "W1", higher_timeframe: "W1" },
  ])
    assert.equal(
      signalSchema.safeParse({ ...setup, ...changed }).success,
      false,
    );
  assert.equal(
    signalSchema.safeParse({
      ...setup,
      strategy: "QM",
      timeframe: "W1",
      higher_timeframe: null,
    }).success,
    true,
  );
  const alert = webhookSchema.parse({
    ...setup,
    secret: "x".repeat(32),
    timestamp: new Date(now).toISOString(),
    event_id: "fixture-method-001",
  });
  assert.notEqual(
    webhookFingerprint(alert),
    webhookFingerprint({ ...alert, strategy: "QM" }),
  );
});

test("QMTR is no longer accepted as a method", () => {
  assert.equal(
    signalSchema.safeParse({
      instrument: "XAUUSD",
      direction: "BUY",
      entry: 2000,
      stop_loss: 1990,
      tp1: 2010,
      tp2: 2020,
      tp3: 2030,
      reasoning: "A test-only retired method validation fixture.",
      access: "public",
      strategy: "QMTR",
      timeframe: "H1",
      higher_timeframe: "H4",
    }).success,
    false,
  );
});
