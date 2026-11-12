import { test } from "node:test";
import assert from "node:assert/strict";
import {
  technicalAnalysis,
  mt5TechnicalAnalysis,
  fundamentalAnalysis,
  buildIntelligence,
  parseEconomicFigure,
} from "../lib/intelligence/engine";
import {
  requestExplanationDraft,
  analysisDigest,
} from "../lib/intelligence/explanations";
import type { LicensedQuote, CalendarEvent } from "../lib/market-data";
const now = Date.parse("2026-10-28T10:30:30Z");
const provider = "00000000-0000-4000-8000-000000000099";
function history(direction = 1): LicensedQuote[] {
  return Array.from({ length: 41 }, (_, i) => {
    const observed_at = new Date(now - 30000 - (40 - i) * 60000).toISOString();
    return {
      id: `fixture-${i}`,
      provider_id: provider,
      reference: `FICTIONAL-${i}`,
      instrument: "XAUUSD",
      bid: 2000 + direction * i,
      ask: 2000.2 + direction * i,
      observed_at,
      received_at: observed_at,
      max_gap_seconds: 60,
      source_name: "FICTIONAL TEST SOURCE",
    };
  });
}
function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "00000000-0000-4000-8000-000000000088",
    provider_id: provider,
    reference: "FICTIONAL-CPI",
    name: "FICTIONAL Consumer Price Index",
    country: "United States",
    currency: "USD",
    event_time: new Date(now + 30 * 60000).toISOString(),
    previous: null,
    forecast: "2.0%",
    actual: null,
    importance: "high",
    source_updated_at: new Date(now - 60000).toISOString(),
    source_url: "https://example.test/fixture",
    source_name: "FICTIONAL CALENDAR",
    received_at: new Date(now - 30000).toISOString(),
    version: 1,
    ...overrides,
  };
}
test("MT5 technical context uses completed candles and withholds stale evidence", () => {
  const serverTime = Math.floor(now / 1000) + 7200;
  const snapshot = {
    source: "Vestrado MT5",
    symbol: "XAUUSD.V",
    server_time_raw: serverTime,
    exported_at: new Date(now - 5000).toISOString(),
    received_at: new Date(now - 3000).toISOString(),
    quote: { bid: 2029, ask: 2029.2, last_tick_time_raw: serverTime - 1 },
  };
  function series(timeframe: string, seconds: number, direction = 1) {
    return {
      timeframe,
      candles: Array.from({ length: 30 }, (_, i) => {
        const close = 2000 + i * direction;
        return {
          opened_at_server_raw: serverTime - (30 - i) * seconds,
          open: close,
          close,
          low: close - 0.5,
          high: close + 0.5,
        };
      }),
    };
  }
  const feed = {
    ...snapshot,
    M30: series("M30", 1800),
    H1: series("H1", 3600),
    H4: series("H4", 14400),
  };
  const report = mt5TechnicalAnalysis(feed, now);
  assert.equal(report.bias, "bullish");
  assert.equal(report.metrics.h1_rsi, 100);
  assert.equal(report.evidence[0].source, "Vestrado MT5");
  assert.equal(report.valid_until, new Date(now + 25_000).toISOString());
  const mixed = mt5TechnicalAnalysis(
    { ...feed, H4: series("H4", 14400, -1) },
    now,
  );
  assert.equal(mixed.bias, "neutral");
  assert.equal(mixed.metrics.h4_bias, "bearish");
  const stale = mt5TechnicalAnalysis(feed, now + 25_000);
  assert.equal(stale.bias, "insufficient_data");
  assert.deepEqual(stale.metrics, {});
  const incomplete = structuredClone(feed);
  incomplete.H4.candles.at(-1)!.opened_at_server_raw += 1;
  assert.equal(mt5TechnicalAnalysis(incomplete, now).bias, "insufficient_data");
  const inputs = { quotes: [], events: [], as_of: new Date(now).toISOString() };
  assert.equal(
    buildIntelligence(inputs, now, report).technical.bias,
    "bullish",
  );
  assert.equal(
    buildIntelligence({ ...inputs, quotes: history(-1) }, now, report).technical
      .bias,
    "bearish",
  );
});

test("technical rules distinguish rising, falling and flat observations with provenance", () => {
  const rising = technicalAnalysis(history(), now);
  assert.equal(rising.bias, "bullish");
  assert.equal(rising.evidence.length, 40);
  assert.equal(rising.metrics.rsi14, 100);
  assert.equal(rising.metrics.completed_minutes, 40);
  assert.equal(rising.metrics.momentum10, 10);
  assert.ok(Number(rising.metrics.ema9) > Number(rising.metrics.ema21));
  assert.equal(rising.model_status, "disconnected");
  assert.equal(technicalAnalysis(history(-1), now).bias, "bearish");
  const flat = technicalAnalysis(history(0), now);
  assert.equal(flat.bias, "neutral");
  assert.equal(flat.metrics.rsi14, 50);
  assert.equal(flat.metrics.minute_return_volatility_pct, 0);
});
test("technical analysis rejects stale, gapped, mixed, duplicated and short inputs", () => {
  const h = history();
  for (const quotes of [
    [],
    h.slice(-10),
    h.filter((_, i) => i !== 20),
    [...h.slice(0, 10), h[9], ...h.slice(10)],
    h.map((q, i) =>
      i === 4
        ? { ...q, provider_id: "00000000-0000-4000-8000-000000000098" }
        : q,
    ),
  ])
    assert.equal(technicalAnalysis(quotes, now).bias, "insufficient_data");
  assert.equal(technicalAnalysis(h, now + 61000).bias, "insufficient_data");
  assert.equal(
    technicalAnalysis(
      h.map((q, i) => (i === 3 ? { ...q, bid: NaN } : q)),
      now,
    ).bias,
    "insufficient_data",
  );
  const dense = h.map((q, i) => ({
    ...q,
    observed_at: new Date(now - (40 - i) * 1000).toISOString(),
    received_at: new Date(now - (40 - i) * 1000).toISOString(),
  }));
  assert.equal(technicalAnalysis(dense, now).bias, "insufficient_data");
});
test("pre-news requires a fresh future release and never invents the actual", () => {
  const report = fundamentalAnalysis(event(), "pre_news", now);
  assert.equal(report.bias, "neutral");
  assert.equal(report.scenarios.length, 3);
  assert.equal(report.metrics.actual, null);
  assert.equal(report.metrics.previous, null);
  assert.equal(report.evidence[0].reference, "FICTIONAL-CPI");
  for (const release of [
    undefined,
    event({ forecast: null }),
    event({ actual: "2.1%" }),
    event({ event_time: new Date(now - 60000).toISOString() }),
    event({ source_updated_at: new Date(now - 25 * 60 * 60000).toISOString() }),
  ])
    assert.equal(
      fundamentalAnalysis(release, "pre_news", now).bias,
      "insufficient_data",
    );
});
test("post-news compares matching units without assigning a gold prediction", () => {
  const released = event({
    event_time: new Date(now - 600000).toISOString(),
    actual: "2.2%",
  });
  const report = fundamentalAnalysis(released, "post_news", now);
  assert.equal(report.bias, "neutral");
  assert.equal(report.metrics.comparison, "above");
  assert.ok(Math.abs(Number(report.metrics.surprise) - 0.2) < 1e-10);
  assert.equal(
    fundamentalAnalysis({ ...released, actual: "1.8%" }, "post_news", now)
      .metrics.comparison,
    "below",
  );
  assert.equal(
    fundamentalAnalysis({ ...released, actual: "2.0%" }, "post_news", now)
      .metrics.comparison,
    "in_line",
  );
  for (const actual of [null, "N/A", "2.1M", "--"])
    assert.equal(
      fundamentalAnalysis({ ...released, actual }, "post_news", now).bias,
      "insufficient_data",
    );
  assert.equal(
    fundamentalAnalysis(event({ actual: "2.2%" }), "post_news", now).bias,
    "insufficient_data",
  );
});
test("figure parser refuses unit conversion and ambiguous localized values", () => {
  assert.deepEqual(parseEconomicFigure("123,000 K"), {
    value: 123000,
    unit: "K",
  });
  assert.deepEqual(parseEconomicFigure("-0.1%"), { value: -0.1, unit: "%" });
  for (const value of [null, "1,23", "2,1%", "about 2%", "N/A", ""])
    assert.equal(parseEconomicFigure(value), null);
});
test("high-impact calendar context adds a warning without creating a signal", () => {
  const result = buildIntelligence({
    quotes: history(),
    events: [event()],
    as_of: new Date(now).toISOString(),
  });
  assert.equal(result.technical.bias, "bullish");
  assert.ok(
    result.technical.limitations.some((l) => l.includes("high-impact")),
  );
  assert.equal("signal" in result, false);
  assert.equal(result.post_news[0].bias, "insufficient_data");
});
test("model drafts bind to evidence, stay unreviewed and reject fabricated references", async () => {
  const analysis = technicalAnalysis(history(), now);
  const digest = analysisDigest(analysis);
  const valid = {
    analysis_digest: digest,
    paragraphs: [
      {
        text: "The documented observations show aligned upward trend and momentum.",
        source_ids: [analysis.evidence[0].id],
      },
    ],
  };
  const draft = await requestExplanationDraft(
    analysis,
    async () => valid,
    () => now,
  );
  assert.equal(draft.status, "unreviewed");
  assert.equal("signal" in draft, false);
  for (const raw of [
    { ...valid, signal: "BUY" },
    { ...valid, analysis_digest: "a".repeat(64) },
    {
      ...valid,
      paragraphs: [
        {
          text: "An explanation that cites a fabricated source identifier.",
          source_ids: ["invented-id"],
        },
      ],
    },
    {
      ...valid,
      paragraphs: [
        {
          text: "An explanation without any source references to review.",
          source_ids: [],
        },
      ],
    },
  ])
    await assert.rejects(
      requestExplanationDraft(
        analysis,
        async () => raw,
        () => now,
      ),
    );
  let called = false;
  await assert.rejects(
    requestExplanationDraft(
      technicalAnalysis([], now),
      async () => {
        called = true;
        return valid;
      },
      () => now,
    ),
    /Fresh sufficient/,
  );
  assert.equal(called, false);
  await assert.rejects(
    requestExplanationDraft(
      analysis,
      async () => valid,
      () => now + 120000,
    ),
    /Fresh sufficient/,
  );
  let late = now;
  await assert.rejects(
    requestExplanationDraft(
      analysis,
      async () => {
        late += 60000;
        return valid;
      },
      () => late,
    ),
    /expired while/,
  );
  await assert.rejects(
    requestExplanationDraft(
      analysis,
      async () => {
        throw new Error("private provider diagnostic");
      },
      () => now,
    ),
    /^Error: Explanation provider request failed; no provider details are exposed$/,
  );
});
