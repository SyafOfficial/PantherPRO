"use client";
import { useEffect, useState } from "react";
import type { MT5Display } from "@/lib/engine/display";
import { marketContext } from "@/lib/market-context";
import type { OfficialNews } from "@/lib/official-news";
import { malaysiaTime } from "@/lib/market-data";
import MT5Chart from "./mt5-chart";
export function OfficialNewsPanel() {
  const [news, setNews] = useState<OfficialNews | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      active: AbortController | null = null;
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 60000);
        return;
      }
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), 10000);
      try {
        const response = await fetch("/api/context/news", {
          cache: "no-store",
          signal: active.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const value = await response.json();
        if (!stopped) {
          setNews(value);
          setFailed(false);
        }
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        clearTimeout(timeout);
      }
      if (!stopped) timer = setTimeout(poll, 60000);
    };
    void poll();
    return () => {
      stopped = true;
      active?.abort();
      clearTimeout(timer);
    };
  }, []);
  return (
    <section className="panel content-panel">
      <div className="section-title">
        <h2>Latest official releases</h2>
        <span className="outline-tag">FED · BLS</span>
      </div>
      <p>
        Official headlines and publication times. These are released statements,
        not forecasts or a complete upcoming economic calendar.
      </p>
      {failed && (
        <p role="status">
          Official release feed is unavailable. Previously loaded headlines
          retain their original publication dates.
        </p>
      )}
      {!news && !failed && <p>Loading official releases…</p>}
      {news?.headlines.length === 0 && (
        <p>
          No verified headlines were returned by the configured official feeds.
        </p>
      )}
      {news?.headlines.map((h) => (
        <article className="delivery-row" key={h.url}>
          <strong>
            <a href={h.url} target="_blank" rel="noopener noreferrer">
              {h.title} ↗
            </a>
          </strong>
          <span>
            {h.source} · {malaysiaTime(h.published_at)} MYT
          </span>
        </article>
      ))}
      {news && (
        <>
          <small>
            Feed checked {malaysiaTime(news.fetched_at)} MYT · refresh about
            once a minute. Older release dates remain visible.
          </small>
          <p>
            {news.sources.map((s) => `${s.source}: ${s.status}`).join(" · ")}
          </p>
        </>
      )}
      <small>
        PMI, consensus forecasts and verified actual-value fields are not
        connected. Headlines do not automatically change the signal engine's
        news filter.
      </small>
    </section>
  );
}
export default function MarketContextPanel({
  data,
  fresh,
  timeframe,
  onTimeframe,
}: {
  data: MT5Display | null;
  fresh: boolean;
  timeframe: string;
  onTimeframe: (frame: string) => void;
}) {
  const context = data ? marketContext(data, Date.now()) : null;
  const ready = context && context.status !== "insufficient_history";
  const fmt = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "Unavailable";
  return (
    <>
      <section className="panel content-panel">
        <div className="section-title">
          <h2>XAUUSD · Market context</h2>
          <span className="outline-tag">
            {data ? (fresh ? "LIVE MARKET" : "STALE DATA") : "CONNECTING"}
          </span>
        </div>
        <label>
          Analysis timeframe{" "}
          <select
            aria-label="Analysis timeframe"
            value={timeframe}
            onChange={(e) => onTimeframe(e.target.value)}
          >
            {["M5", "M15", "M30", "H1", "H4", "W1", "MN1"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <p>Market structure for your selected timeframe.</p>
        {data ? (
          <>
            <MT5Chart data={data} fresh={fresh} />
          </>
        ) : (
          <p>Market history is currently unavailable.</p>
        )}
      </section>
      <div className="three-grid market-analysis-grid">
        <section className="panel content-panel">
          <h3>Trend & momentum</h3>
          {ready ? (
            <>
              <dl className="market-momentum">
                <div>
                  <dt>Market bias</dt>
                  <dd className={`bias-${context.bias}`}>
                    {context.bias === "mixed"
                      ? "MIXED"
                      : context.bias.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>RSI14</dt>
                  <dd>
                    {fmt(context.rsi14)} · {context.momentum.zone.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>Momentum</dt>
                  <dd className={`bias-${context.momentum.direction}`}>
                    {context.momentum.direction.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>Bias alignment</dt>
                  <dd>
                    {context.momentum.alignment === "aligned"
                      ? "ALIGNED"
                      : context.momentum.alignment === "against_bias"
                        ? "AGAINST BIAS"
                        : "UNCONFIRMED"}
                  </dd>
                </div>
              </dl>
              <p className="momentum-guide">
                RSI ≥70: high / overbought · ≤30: low / oversold.
                <br />
                Above 50: bullish momentum · below 50: bearish · 50: neutral.
              </p>
              <small>
                Bias uses {context.timeframe} structure and EMA20/50 alignment.
                RSI measures momentum; high/low readings alone do not signal a
                reversal or entry.
              </small>
              <p>
                EMA20 {fmt(context.ema20)} · EMA50 {fmt(context.ema50)}
              </p>
              <small>
                Based on {context.bars} completed candles.{" "}
                {context.status === "stale" || !fresh
                  ? "Source is stale; these are historical readings."
                  : ""}
              </small>
            </>
          ) : (
            <p>At least 50 completed candles are required.</p>
          )}
        </section>
        <section className="panel content-panel">
          <h3>Support & resistance</h3>
          {ready ? (
            <>
              <dl className="market-momentum">
                <div>
                  <dt>Support</dt>
                  <dd className="bias-bullish">{fmt(context.support)}</dd>
                </div>
                <div>
                  <dt>Resistance</dt>
                  <dd className="bias-bearish">{fmt(context.resistance)}</dd>
                </div>
                <div>
                  <dt>Timeframe</dt>
                  <dd>{context.timeframe}</dd>
                </div>
                <div>
                  <dt>Level basis</dt>
                  <dd>BODY CLOSE</dd>
                </div>
              </dl>
              <small>
                Confirmed origins · invalidated by a candle close through the
                level.
              </small>
            </>
          ) : (
            <p>Insufficient market history for confirmed levels.</p>
          )}
        </section>
      </div>
      <OfficialNewsPanel />
    </>
  );
}
