import {
  quoteFreshness,
  quoteSchema,
  calendarEventSchema,
} from "../market-data";
import type { LicensedQuote, CalendarEvent } from "../market-data";
import type {
  Analysis,
  Evidence,
  IntelligenceBundle,
  IntelligenceInputs,
} from "./types";
import { newsProfile, newsRisk } from "../news-context";
import { parseFedRate, compareFedRates } from "./fed-rates";
const MINUTE = 60000;
const limitations = [
  "Rules-based context, not a trading signal, broker execution or guaranteed prediction.",
  "No language model is connected. Signal publication still requires independent administrator approval.",
];
function base(mode: Analysis["mode"], now: number, title: string): Analysis {
  return {
    mode,
    bias: "insufficient_data",
    title,
    summary: "Insufficient authorized source data.",
    generated_at: new Date(now).toISOString(),
    evidence: [],
    limitations: [...limitations],
    explanations: [],
    metrics: {},
    scenarios: [],
    source_latest_at: null,
    valid_until: null,
    engine: "panther-rules-v1",
    model_status: "disconnected",
  };
}
function missing(report: Analysis, reason: string) {
  return { ...report, bias: "insufficient_data" as const, summary: reason };
}
function quoteEvidence(q: LicensedQuote): Evidence {
  return {
    id: q.id,
    provider_id: q.provider_id,
    source: q.source_name,
    timestamp: q.observed_at,
    reference: q.reference,
  };
}
function eventEvidence(e: CalendarEvent): Evidence {
  return {
    id: e.id,
    provider_id: e.provider_id,
    source: e.source_name,
    timestamp: e.source_updated_at,
    reference: e.reference,
  };
}
function ema(values: number[], period: number) {
  let average = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const value of values.slice(period))
    average = (value * 2) / (period + 1) + average * (1 - 2 / (period + 1));
  return average;
}
function rsi(values: number[]) {
  const changes = values
    .slice(-15)
    .slice(1)
    .map((v, i) => v - values.slice(-15)[i]);
  const gain = changes.reduce((a, b) => a + Math.max(0, b), 0) / 14;
  const loss = changes.reduce((a, b) => a + Math.max(0, -b), 0) / 14;
  return gain === 0 && loss === 0
    ? 50
    : loss === 0
      ? 100
      : 100 - 100 / (1 + gain / loss);
}
export function technicalAnalysis(
  quotes: LicensedQuote[],
  now: number,
): Analysis {
  const report = base("technical", now, "Technical intelligence");
  if (!quotes.length)
    return missing(report, "No analysis-permitted price source is connected.");
  if (quotes.length > 5000)
    return missing(
      report,
      "Observation batch exceeds the supported analysis window.",
    );
  const first = quotes[0];
  let previous = -Infinity;
  for (const q of quotes) {
    const valid = quoteSchema.safeParse({
      provider_id: q.provider_id,
      reference: q.reference,
      instrument: q.instrument,
      bid: Number(q.bid),
      ask: Number(q.ask),
      observed_at: q.observed_at,
    });
    const time = Date.parse(q.observed_at),
      receipt = Date.parse(q.received_at);
    if (
      !valid.success ||
      !q.id ||
      typeof q.source_name !== "string" ||
      !q.source_name.trim() ||
      q.provider_id !== first.provider_id ||
      !Number.isInteger(q.max_gap_seconds) ||
      q.max_gap_seconds < 1 ||
      q.max_gap_seconds > 3600 ||
      !Number.isFinite(receipt) ||
      receipt > now + 5000 ||
      time > receipt + 5000 ||
      time > now + 5000 ||
      time <= previous
    )
      return missing(
        report,
        "Invalid, mixed-source or out-of-order observations; no analysis generated.",
      );
    if (previous !== -Infinity && time - previous > q.max_gap_seconds * 1000)
      return missing(
        report,
        "A source gap interrupts the observation window. No missing price path is inferred.",
      );
    previous = time;
  }
  const latest = quotes.at(-1)!;
  report.evidence = [quoteEvidence(latest)];
  report.source_latest_at = latest.observed_at;
  report.valid_until = new Date(
    Math.min(Date.parse(latest.observed_at), Date.parse(latest.received_at)) +
      latest.max_gap_seconds * 1000,
  ).toISOString();
  if (!quoteFreshness(latest, now))
    return missing(
      report,
      "The latest quote is stale. Refresh the licensed feed before using technical context.",
    );
  const minutes = new Map<number, LicensedQuote>();
  const currentMinute = Math.floor(now / MINUTE);
  for (const q of quotes) {
    const bucket = Math.floor(Date.parse(q.observed_at) / MINUTE);
    if (bucket < currentMinute) minutes.set(bucket, q);
  }
  const samples = [...minutes.entries()].slice(-60);
  if (samples.length < 30)
    return missing(
      report,
      "At least 30 contiguous completed minute observations are required. Sparse quote snapshots are not exchange candles.",
    );
  if (
    samples.at(-1)![0] !== currentMinute - 1 ||
    samples.some((s, i) => i > 0 && s[0] !== samples[i - 1][0] + 1)
  )
    return missing(
      report,
      "Completed minute observations are missing; technical context is withheld.",
    );
  const points = samples.map(([, q]) => q);
  const values = points.map((q) => (Number(q.bid) + Number(q.ask)) / 2);
  const fast = ema(values, 9),
    slow = ema(values, 21),
    momentum = values.at(-1)! - values.at(-11)!,
    strength = rsi(values);
  const returns = values.slice(1).map((v, i) => Math.log(v / values[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility =
    Math.sqrt(
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length,
    ) * 100;
  const averageSpread =
    points.reduce((a, q) => a + Number(q.ask) - Number(q.bid), 0) /
    points.length;
  const threshold = Math.max(averageSpread * 0.5, values.at(-1)! * 0.00001);
  const up = fast - slow > threshold && momentum > threshold && strength >= 55;
  const down =
    slow - fast > threshold && momentum < -threshold && strength <= 45;
  report.bias = up ? "bullish" : down ? "bearish" : "neutral";
  report.summary = up
    ? "Observed trend and momentum align upward. This is context, not an entry recommendation."
    : down
      ? "Observed trend and momentum align downward. This is context, not an entry recommendation."
      : "Observed indicators do not establish directional confluence.";
  report.evidence = points.map(quoteEvidence);
  report.metrics = {
    ema9: fast,
    ema21: slow,
    rsi14: strength,
    momentum10: momentum,
    minute_return_volatility_pct: volatility,
    observed_range_low: Math.min(...values.slice(-20)),
    observed_range_high: Math.max(...values.slice(-20)),
    completed_minutes: points.length,
    average_spread: averageSpread,
  };
  report.explanations = [
    `EMA(9) ${fast > slow ? "exceeds" : fast < slow ? "is below" : "equals"} EMA(21) on completed minute quote midpoints.`,
    `Ten-minute midpoint change is ${momentum.toFixed(4)} USD; simple-window RSI(14) is ${strength.toFixed(1)}.`,
    strength >= 70
      ? "RSI is elevated; strong momentum can persist or reverse."
      : strength <= 30
        ? "RSI is depressed; weak momentum can persist or reverse."
        : "RSI does not show an extreme under the documented 30/70 thresholds.",
  ];
  report.limitations.push(
    "Ranges are observed midpoint proxies, not validated support/resistance, order-book liquidity or full OHLC candles.",
    "Volatility is sampled one-minute log-return dispersion, not an annualized or forecast volatility.",
    "The RSI uses a simple 14-change window, not Wilder smoothing. EMA initialization and sample window affect readings.",
  );
  return report;
}
export function parseEconomicFigure(
  value: string | null,
): { value: number; unit: string } | null {
  if (value === null) return null;
  const parsed =
    /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(%|K|M|B|bps)?$/.exec(
      value.trim(),
    );
  if (!parsed) return null;
  const numeric = Number(parsed[1].replaceAll(",", ""));
  return Number.isFinite(numeric)
    ? { value: numeric, unit: parsed[2] ?? "number" }
    : null;
}
export function fundamentalAnalysis(
  event: CalendarEvent | undefined,
  mode: "pre_news" | "post_news",
  now: number,
): Analysis {
  const report = base(
    mode,
    now,
    mode === "pre_news" ? "Pre-news scenarios" : "Post-news context",
  );
  if (!event)
    return missing(
      report,
      "No analysis-permitted calendar release is available for this mode.",
    );
  const { id, source_name, received_at, version, ...normalized } = event;
  if (
    !calendarEventSchema.safeParse(normalized).success ||
    !id ||
    !source_name ||
    !Number.isInteger(version) ||
    version < 1
  )
    return missing(
      report,
      "The calendar record is invalid; no release facts are inferred.",
    );
  report.event_id = id;
  report.title = event.name;
  report.evidence = [eventEvidence(event)];
  report.source_latest_at = event.source_updated_at;
  const sourceTime = Date.parse(event.source_updated_at),
    releaseTime = Date.parse(event.event_time),
    receipt = Date.parse(received_at);
  report.valid_until = new Date(
    Math.min(
      sourceTime + 24 * 60 * MINUTE,
      mode === "pre_news" ? releaseTime : releaseTime + 24 * 60 * MINUTE,
    ),
  ).toISOString();
  if (
    !Number.isFinite(receipt) ||
    receipt > now + 5000 ||
    sourceTime > receipt + 5000 ||
    sourceTime > now + 5000 ||
    now - sourceTime > 24 * 60 * MINUTE
  )
    return missing(
      report,
      "Calendar provenance is stale or inconsistent. Refresh the licensed source before analysis.",
    );
  const profile = newsProfile(event.name);
  report.metrics = {
    forecast: event.forecast,
    previous: event.previous,
    actual: event.actual,
    event_time: event.event_time,
    source_revision: version,
    event_category: profile.label,
  };
  report.limitations.push(...profile.checkpoints);
  const pre = mode === "pre_news";
  if (
    pre &&
    (releaseTime <= now ||
      releaseTime > now + 24 * 60 * MINUTE ||
      event.actual !== null)
  )
    return missing(
      report,
      "Pre-news scenarios require an unreleased event within the next 24 hours.",
    );
  if (!pre && (releaseTime > now || now - releaseTime > 24 * 60 * MINUTE))
    return missing(
      report,
      "Post-news context requires a released event from the last 24 hours.",
    );
  if (profile.format === "communication") {
    if (!pre)
      return missing(
        report,
        "Verified FOMC statement, minutes or press-conference text and policy expectations are required. A calendar row alone cannot establish hawkish or dovish tone.",
      );
    report.bias = "neutral";
    report.summary =
      "Hypothetical FOMC communication scenarios. No statement tone, policy probabilities or official quotes are supplied or inferred.";
    report.scenarios = [
      {
        condition: "If verified guidance is more hawkish than expected",
        interpretation: profile.above,
      },
      {
        condition: "If guidance is broadly balanced or expected",
        interpretation: profile.inline,
      },
      {
        condition: "If verified guidance is more dovish than expected",
        interpretation: profile.below,
      },
    ];
    report.explanations = [profile.focus];
    return report;
  }
  const expectedRate =
    profile.kind === "fed_rate" ? parseFedRate(event.forecast) : null;
  const forecast = parseEconomicFigure(event.forecast);
  if (profile.kind === "fed_rate" ? !expectedRate : !forecast)
    return missing(
      report,
      profile.kind === "fed_rate"
        ? "A source-consensus policy rate or target range in percent is required; missing rates are not estimated."
        : "A parseable source consensus forecast is required; missing or ambiguous figures are not estimated.",
    );
  if (pre) {
    report.bias = "neutral";
    report.summary =
      "Conditional XAUUSD news scenarios around source consensus. No outcome, probability or trade direction is predicted.";
    report.scenarios = [
      {
        condition: `Actual above ${event.forecast}`,
        interpretation: profile.above,
      },
      {
        condition: `Actual near ${event.forecast}`,
        interpretation: profile.inline,
      },
      {
        condition: `Actual below ${event.forecast}`,
        interpretation: profile.below,
      },
    ];
    report.explanations = [profile.focus];
  } else if (profile.kind === "fed_rate") {
    const actual = parseFedRate(event.actual);
    const comparison =
      actual && expectedRate ? compareFedRates(actual, expectedRate) : null;
    if (!actual || !comparison)
      return missing(
        report,
        "Actual and consensus Fed rates must both use the same percent scalar or target-range convention. No midpoint or missing bound is inferred.",
      );
    report.bias = "neutral";
    report.metrics.comparison = comparison.comparison;
    report.metrics.surprise_lower_bps = comparison.lower_bps;
    report.metrics.surprise_upper_bps = comparison.upper_bps;
    const previous = parseFedRate(event.previous);
    const change = previous ? compareFedRates(actual, previous) : null;
    report.metrics.policy_decision = change
      ? change.lower_bps !== change.upper_bps
        ? "range_adjustment"
        : change.comparison === "above"
          ? "hike"
          : change.comparison === "below"
            ? "cut"
            : change.comparison === "in_line"
              ? "hold"
              : "mixed_range"
      : "unavailable";
    report.metrics.policy_change_lower_bps = change?.lower_bps ?? null;
    report.metrics.policy_change_upper_bps = change?.upper_bps ?? null;
    report.summary = `Fed target ${comparison.comparison === "in_line" ? "matched" : comparison.comparison === "above" ? "was above" : comparison.comparison === "below" ? "was below" : "changed bounds in different directions versus"} source consensus. Decision versus previous: ${report.metrics.policy_decision}. Rate changes and expectation surprises are different comparisons.`;
    report.explanations = [
      profile.focus,
      comparison.comparison === "above"
        ? profile.above
        : comparison.comparison === "below"
          ? profile.below
          : comparison.comparison === "in_line"
            ? profile.inline
            : "Mixed target-range changes do not have a simple hawkish/dovish interpretation. Review verified policy communication.",
    ];
  } else {
    const actual = parseEconomicFigure(event.actual);
    if (!actual || !forecast || actual.unit !== forecast.unit)
      return missing(
        report,
        "Actual and consensus must be present, parseable and expressed in the same source units.",
      );
    const delta = actual.value - forecast.value;
    report.bias = "neutral";
    report.metrics.surprise = delta;
    report.metrics.surprise_unit = actual.unit;
    report.metrics.comparison =
      delta > 0 ? "above" : delta < 0 ? "below" : "in_line";
    report.summary =
      delta > 0
        ? "Actual exceeded source consensus. A numerical surprise alone does not establish a gold trade direction."
        : delta < 0
          ? "Actual fell below source consensus. A numerical surprise alone does not establish a gold trade direction."
          : "Actual matched source consensus. Revisions and market context can still matter.";
    report.explanations = [
      profile.focus,
      delta > 0 ? profile.above : delta < 0 ? profile.below : profile.inline,
    ];
    if (profile.kind === "pmi") {
      if (actual.unit !== "number" || forecast.unit !== "number")
        return missing(
          report,
          "Headline activity PMI requires source index points; percentage or other units are not interpreted against 50.",
        );
      report.metrics.activity_regime =
        actual.value > 50
          ? "above_50_expansion"
          : actual.value < 50
            ? "below_50_contraction"
            : "at_50_no_change";
      report.explanations.push(
        `The actual headline activity PMI is ${actual.value > 50 ? "above" : actual.value < 50 ? "below" : "at"} 50. This is separate from the consensus surprise and is not a GDP growth rate.`,
      );
    }
  }
  report.limitations.push(
    "A numerical surprise is not a standardized surprise score and does not establish causation.",
    "US yields, USD behavior, positioning and realized market reactions are not supplied by this calendar record.",
  );
  return report;
}
export function buildIntelligence(
  inputs: IntelligenceInputs,
  now = Date.parse(inputs.as_of),
): IntelligenceBundle {
  const technical = technicalAnalysis(inputs.quotes, now);
  const upcoming = inputs.events
    .filter((e) => Date.parse(e.event_time) > now)
    .sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time))
    .slice(0, 5);
  const released = inputs.events
    .filter((e) => Date.parse(e.event_time) <= now)
    .sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time))
    .slice(0, 5);
  const risk = newsRisk(inputs.events, now);
  if (risk.events.length)
    technical.limitations.push(
      "A high-impact or watched US release requires attention. " + risk.message,
    );
  if (risk.source_freshness_unverified)
    technical.limitations.push(
      "News source freshness is unverified; confirm the scheduled release with an authorized current source.",
    );
  if (!inputs.events.length)
    technical.limitations.push(
      "No permitted calendar context is available; this is technical-only analysis.",
    );
  return {
    technical,
    pre_news: upcoming.length
      ? upcoming.map((e) => fundamentalAnalysis(e, "pre_news", now))
      : [fundamentalAnalysis(undefined, "pre_news", now)],
    post_news: released.length
      ? released.map((e) => fundamentalAnalysis(e, "post_news", now))
      : [fundamentalAnalysis(undefined, "post_news", now)],
    error: false,
  };
}
