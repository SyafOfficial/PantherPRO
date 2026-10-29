"use client";
import { useEffect, useState } from "react";
import { Sparkles, ShieldCheck, Clock3, ArrowUpRight } from "lucide-react";
import type { Analysis, IntelligenceBundle } from "@/lib/intelligence/types";
import { malaysiaTime } from "@/lib/market-data";
const labels: Record<string, string> = {
  ema9: "EMA · 9 minutes",
  ema21: "EMA · 21 minutes",
  rsi14: "RSI · simple 14-change",
  momentum10: "10-minute midpoint change",
  minute_return_volatility_pct: "Observed minute volatility (%)",
  observed_range_low: "Observed range low",
  observed_range_high: "Observed range high",
  completed_minutes: "Completed minute observations",
  average_spread: "Average sampled spread",
  forecast: "Source consensus",
  previous: "Source previous",
  actual: "Source actual",
  event_time: "Scheduled release",
  source_revision: "Source revision",
  surprise: "Actual minus consensus",
  surprise_unit: "Comparison unit",
  comparison: "Compared with consensus",
  event_category: "Release category",
  surprise_lower_bps: "Lower-bound surprise (bps)",
  surprise_upper_bps: "Upper-bound surprise (bps)",
  policy_decision: "Decision versus previous",
  policy_change_lower_bps: "Lower-bound change (bps)",
  policy_change_upper_bps: "Upper-bound change (bps)",
  activity_regime: "Headline activity PMI regime",
};
export default function IntelligencePanel({
  bundle,
}: {
  bundle: IntelligenceBundle;
}) {
  const [mode, setMode] = useState<"technical" | "pre_news" | "post_news">(
    "technical",
  );
  const reports = mode === "technical" ? [bundle.technical] : bundle[mode];
  return (
    <>
      <section className="panel ai-hero">
        <Sparkles size={36} />
        <span className="eyebrow">PANTHER INTELLIGENCE</span>
        <h2>Clarity begins with evidence.</h2>
        <p>
          Timestamped technical context and conditional news scenarios. These
          reports use transparent rules; model-generated explanations are not
          connected.
        </p>
        <span className="purple-tag">RULES-BASED · MODEL DISCONNECTED</span>
      </section>
      {bundle.error && (
        <div className="error-message" role="alert">
          Analysis sources could not be loaded. Check the intelligence migration
          and source permissions.
        </div>
      )}
      <div className="analysis-tabs" role="group" aria-label="Analysis mode">
        {(
          [
            ["technical", "Technical intelligence"],
            ["pre_news", "Pre-news scenarios"],
            ["post_news", "Post-news analysis"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={mode === value ? "active" : ""}
          >
            {label}
          </button>
        ))}
      </div>
      {reports.map((report, i) => (
        <AnalysisCard key={`${mode}-${report.event_id ?? i}`} report={report} />
      ))}
      <div className="panel analysis-boundary">
        <ShieldCheck size={22} />
        <p>
          Analysis provides context. It does not create a signal, execute
          trades, establish broker fills or replace administrator review. There
          are no guaranteed outcomes.
        </p>
      </div>
    </>
  );
}
function AnalysisCard({ report }: { report: Analysis }) {
  const [clock, setClock] = useState(Date.parse(report.generated_at));
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = Boolean(
    report.valid_until && clock >= Date.parse(report.valid_until),
  );
  const bias = expired ? "insufficient_data" : report.bias;
  const sufficient = bias !== "insufficient_data";
  return (
    <article
      className="panel analysis-card"
      aria-label={
        report.mode === "technical"
          ? "Technical analysis report"
          : report.mode === "pre_news"
            ? "Pre-news analysis report"
            : "Post-news analysis report"
      }
    >
      <div className="section-title">
        <div>
          <div className="eyebrow">
            {report.mode.replaceAll("_", " ").toUpperCase()} · {report.engine}
          </div>
          <h2>{report.title}</h2>
        </div>
        <span className={`analysis-bias bias-${bias}`}>
          Bias: {bias.replaceAll("_", " ")}
        </span>
      </div>
      <p className="analysis-summary">
        {expired
          ? "This report has expired. Refresh permitted sources before using its context."
          : report.summary}
      </p>
      <div className="analysis-timestamps">
        <span>
          <Clock3 size={13} /> Generated {malaysiaTime(report.generated_at)} MYT
        </span>
        <span>
          {report.source_latest_at
            ? `Source ${malaysiaTime(report.source_latest_at)} MYT`
            : "No usable source timestamp"}
        </span>
      </div>
      {sufficient && (
        <>
          <div className="analysis-metrics">
            {Object.entries(report.metrics).map(([key, value]) => (
              <div key={key}>
                <span>{labels[key] ?? key.replaceAll("_", " ")}</span>
                <strong>
                  {value === null
                    ? "Not available"
                    : key === "event_time"
                      ? malaysiaTime(String(value)) + " MYT"
                      : typeof value === "number"
                        ? value.toLocaleString("en-US", {
                            maximumFractionDigits: 4,
                          })
                        : String(value)}
                </strong>
              </div>
            ))}
          </div>
          {report.explanations.map((text, i) => (
            <p key={i} className="analysis-explanation">
              {text}
            </p>
          ))}
          {report.scenarios.length > 0 && (
            <div className="analysis-scenarios">
              {report.scenarios.map((s) => (
                <section key={s.condition}>
                  <h3>{s.condition}</h3>
                  <p>{s.interpretation}</p>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      <details className="analysis-provenance">
        <summary>
          Sources & limitations <ArrowUpRight size={14} />
        </summary>
        <p>
          No language model is connected. These explanations are generated by
          documented deterministic rules.
        </p>
        <ul>
          {report.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {report.evidence.length > 0 ? (
          <div className="evidence-list">
            {report.evidence.map((e) => (
              <div key={e.id}>
                <strong>{e.source}</strong>
                <span>
                  {malaysiaTime(e.timestamp)} MYT · {e.reference}
                </span>
                <code>{e.id}</code>
              </div>
            ))}
          </div>
        ) : (
          <p>No authorized evidence is available.</p>
        )}
      </details>
    </article>
  );
}
