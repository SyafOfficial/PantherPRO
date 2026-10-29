import type { CalendarEvent } from "./market-data";
export type NewsKind =
  | "fed_rate"
  | "fomc"
  | "nfp"
  | "cpi"
  | "ppi"
  | "pmi"
  | "unemployment"
  | "other";
export type NewsProfile = {
  kind: NewsKind;
  label: string;
  format: "numeric" | "communication";
  focus: string;
  above: string;
  below: string;
  inline: string;
  checkpoints: string[];
};
const caveat =
  "The outcome depends on what was priced in, real yields, USD behavior and risk sentiment; this is not a BUY or SELL instruction.";
export const XAUUSD_NEWS_GUIDE: NewsProfile[] = [
  {
    kind: "fed_rate",
    label: "Federal Reserve rate decision",
    format: "numeric",
    focus:
      "Policy rates and the expected path of real yields affect the opportunity cost of holding non-yielding gold.",
    above:
      "A higher-than-expected target rate, including a smaller cut than expected, can support US yields and USD and pressure XAUUSD if markets read the decision as hawkish. " +
      caveat,
    below:
      "A lower-than-expected target rate, including a larger cut than expected, can weigh on yields and USD and support XAUUSD if markets read it as dovish. " +
      caveat,
    inline:
      "An expected hike, cut or hold may already be priced in. The statement, projections, dot plot when published, and press conference can dominate the initial rate reaction.",
    checkpoints: [
      "Compare actual with consensus and the previous target; a cut is not automatically a dovish surprise.",
      "Distinguish a target range from a single upper-bound rate; do not compare unlike conventions.",
      "Check the statement, projections and press conference only when verified source text is available.",
    ],
  },
  {
    kind: "fomc",
    label: "FOMC communications",
    format: "communication",
    focus:
      "Statements, minutes, projections and the Fed press conference can change expectations for the future rate path even when the policy rate is unchanged.",
    above:
      "If verified communication is more hawkish than market expectations, yields and USD may rise and gold may face pressure. " +
      caveat,
    below:
      "If verified communication is more dovish than market expectations, yields and USD may soften and gold may find support. " +
      caveat,
    inline:
      "Balanced guidance or no meaningful change in the expected path may leave attention on positioning, incoming data and risk sentiment. A hold does not establish a neutral tone.",
    checkpoints: [
      "Hawkish/dovish scenarios are hypothetical, not classifications of an unread statement.",
      "Minutes describe an earlier meeting; distinguish their release time from the meeting date.",
      "No policy probabilities, dot-plot values or Powell quotes are inferred from a calendar row.",
    ],
  },
  {
    kind: "nfp",
    label: "Non-Farm Payrolls (NFP)",
    format: "numeric",
    focus:
      "Payroll surprises can reshape expectations for US growth, labor tightness and Fed policy.",
    above:
      "Stronger-than-forecast payroll growth can support USD and yields and weigh on XAUUSD if it reduces expected easing. Conflicting unemployment, wages, participation or revisions can reverse that interpretation. " +
      caveat,
    below:
      "Weaker-than-forecast payroll growth can weigh on USD and yields and support XAUUSD if easing expectations rise. Severe risk aversion can change the dollar and gold response. " +
      caveat,
    inline:
      "An in-line payroll headline can still hide important unemployment, wage and revision details. A single jobs number does not establish a gold direction.",
    checkpoints: [
      "Headline payrolls, unemployment and average hourly earnings are separate source figures.",
      "Review prior-month revisions only if the provider supplies them; do not invent wage or revision data.",
      "Differentiate NFP payroll employment from ADP estimates and nonfarm productivity.",
    ],
  },
  {
    kind: "cpi",
    label: "Consumer Price Index (CPI)",
    format: "numeric",
    focus:
      "Consumer inflation surprises can alter Fed expectations and real yields; headline, core, monthly and annual readings can conflict.",
    above:
      "Hotter-than-forecast CPI can reduce expected easing and lift yields or USD, creating a potential headwind for XAUUSD. Inflation-hedging demand and changes in real yields can offset that response. " +
      caveat,
    below:
      "Cooler-than-forecast CPI can strengthen easing expectations, lower yields or USD, and support XAUUSD. Positioning and underlying components can dominate the first move. " +
      caveat,
    inline:
      "An in-line CPI release still requires headline/core and monthly/annual context. No flat-market outcome is assumed.",
    checkpoints: [
      "Compare actual and forecast for the same headline/core and MoM/YoY series.",
      "Watch real yields rather than assuming higher inflation always raises gold.",
      "Do not infer core inflation or components from the headline alone.",
    ],
  },
  {
    kind: "ppi",
    label: "Producer Price Index (PPI)",
    format: "numeric",
    focus:
      "Producer-price inflation can inform upstream cost pressure and rate expectations, but it is not CPI or PCE.",
    above:
      "Hotter-than-forecast PPI may support USD or yields and pressure XAUUSD if markets read it as persistent inflation. Producer costs do not pass through mechanically to consumers or PCE. " +
      caveat,
    below:
      "Cooler-than-forecast PPI may soften rate expectations, yields or USD and support XAUUSD. Components and other inflation releases may outweigh the headline. " +
      caveat,
    inline:
      "An in-line PPI headline does not settle the inflation outlook. Check core and monthly/annual details from the same source series.",
    checkpoints: [
      "Distinguish headline/core PPI and monthly/annual comparisons.",
      "Never treat a PPI surprise as a calculated CPI or PCE release.",
      "Do not infer missing price components or pass-through magnitudes.",
    ],
  },
  {
    kind: "pmi",
    label: "Purchasing Managers’ Index (PMI)",
    format: "numeric",
    focus:
      "Manufacturing and services surveys can shift growth and rate expectations; an activity diffusion index near 50 is not a GDP growth rate.",
    above:
      "A stronger-than-forecast headline activity PMI can support USD or yields and pressure XAUUSD if markets price firmer growth or tighter policy. Prices, employment and risk appetite can produce a different response. " +
      caveat,
    below:
      "A weaker-than-forecast headline activity PMI can lower yields or USD and support XAUUSD if easing expectations rise. A growth scare may also support dollar demand. " +
      caveat,
    inline:
      "An in-line PMI can still matter if its activity reading is above or below 50, or its verified components differ. Survey provider and manufacturing/services coverage must match.",
    checkpoints: [
      "For headline activity PMI, above 50 generally indicates expansion versus the prior month; below 50 indicates contraction.",
      "The 50 threshold is separate from actual-versus-consensus surprise and does not measure GDP growth.",
      "ISM and S&P Global, manufacturing and services, flash and final releases are different series. Prices/employment subindices are not automatically headline activity PMI.",
    ],
  },
];
const unemployment: NewsProfile = {
  kind: "unemployment",
  label: "Unemployment",
  format: "numeric",
  focus:
    "A higher unemployment rate can indicate weaker labor conditions; this is different from stronger payroll growth.",
  above:
    "Higher unemployment can indicate weaker labor conditions. If markets price easier policy, USD may weaken and gold may find support. " +
    caveat,
  below:
    "Lower unemployment can indicate firmer labor conditions. If expected rates rise, USD may strengthen and gold may face pressure. " +
    caveat,
  inline:
    "An in-line unemployment rate still requires participation, wages and payroll context from verified sources.",
  checkpoints: ["Do not treat higher unemployment as stronger payroll growth."],
};
const other: NewsProfile = {
  kind: "other",
  label: "Other US release",
  format: "numeric",
  focus:
    "Indicator-specific details and source consensus are required to interpret a numerical surprise.",
  above:
    "Actual above consensus is a positive numerical surprise; it does not itself establish a gold direction.",
  below:
    "Actual below consensus is a negative numerical surprise; it does not itself establish a gold direction.",
  inline:
    "An in-line figure does not imply a flat market or a guaranteed absence of volatility.",
  checkpoints: [
    "No indicator-specific reaction is invented for an unrecognized release.",
  ],
};
export function classifyNews(name: string): NewsKind {
  const n = name.normalize("NFKC").replace(/[–—]/g, "-");
  if (
    !/effective|futures|probabilit|swap/i.test(n) &&
    /federal funds (?:target |interest )?rate|fed(?:eral reserve)?(?: interest)? rate|fomc.*(?:rate decision|interest rate)|(?:interest rate decision|target rate).*fed/i.test(
      n,
    )
  )
    return "fed_rate";
  if (
    /\bfomc\b|federal open market|fed(?:eral reserve)? (?:chair|statement|minutes|press conference)|powell.*(?:speaks|speech|conference)/i.test(
      n,
    )
  )
    return "fomc";
  if (
    /\bnfp\b|non[- ]?farm(?: payrolls?| employment change)|nonfarm payroll employment/i.test(
      n,
    )
  )
    return "nfp";
  if (/\bcpi\b|consumer price index/i.test(n)) return "cpi";
  if (/\bppi\b|producer price index/i.test(n)) return "ppi";
  const survey =
    /\bpmi\b|purchasing managers?.? index|\bism\b.*(?:manufacturing|services|non.manufacturing)/i.test(
      n,
    );
  if (survey && !/prices|employment|new.orders/i.test(n)) return "pmi";
  if (/unemployment/i.test(n)) return "unemployment";
  return "other";
}
export function newsProfile(name: string): NewsProfile {
  const kind = classifyNews(name);
  return (
    XAUUSD_NEWS_GUIDE.find((p) => p.kind === kind) ??
    (kind === "unemployment" ? unemployment : other)
  );
}
export function newsRisk(events: CalendarEvent[], now: number) {
  const supplied = events.filter(
    (e) =>
      e.country === "United States" &&
      e.currency === "USD" &&
      Number.isFinite(Date.parse(e.event_time)),
  );
  const watched = supplied
    .filter(
      (e) =>
        (e.importance === "high" || classifyNews(e.name) !== "other") &&
        Date.parse(e.event_time) >= now - 15 * 60000 &&
        Date.parse(e.event_time) <= now + 60 * 60000,
    )
    .sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time));
  const releaseWindow = watched.some(
    (e) => Math.abs(Date.parse(e.event_time) - now) <= 15 * 60000,
  );
  return {
    state: releaseWindow
      ? "release_window"
      : watched.length
        ? "scheduled"
        : supplied.length
          ? "no_listed_event"
          : "unavailable",
    events: watched,
    source_freshness_unverified: watched.some(
      (e) =>
        !Number.isFinite(Date.parse(e.source_updated_at)) ||
        now - Date.parse(e.source_updated_at) > 24 * 60 * 60000 ||
        Date.parse(e.source_updated_at) > now + 5000,
    ),
    message: releaseWindow
      ? "A watched US release is within 15 minutes before or after its scheduled time. Spreads, slippage and reversals can overwhelm a technical setup."
      : watched.length
        ? "A watched US release is scheduled within one hour. Review its source and the signal’s risk before acting."
        : supplied.length
          ? "No supplied watched release falls in this window. This does not establish a complete calendar or a news-free market."
          : "Licensed news timing is unavailable. News risk cannot be verified.",
  };
}
