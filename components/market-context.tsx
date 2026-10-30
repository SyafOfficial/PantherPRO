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
            {data ? (fresh ? "MT5 SOURCE" : "STALE SOURCE") : "WAITING FOR MT5"}
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
        <p>
          Calculated from received Vestrado candles. Context is not an entry
          signal or prediction.
        </p>
        {data ? (
          <>
            <MT5Chart data={data} fresh={fresh} />
            <small>
              {data.quote.source_name} · observed{" "}
              {malaysiaTime(data.exported_at)} MYT · broker candle times ·
              snapshots about 10 seconds
            </small>
          </>
        ) : (
          <p>
            Waiting for MT5 candle history. No substitute analysis is generated.
          </p>
        )}
      </section>
      <div className="three-grid">
        <section className="panel content-panel">
          <h3>Trend & momentum</h3>
          {ready ? (
            <>
              <p>
                {context.timeframe} structure:{" "}
                <strong>{context.structure}</strong> · alignment:{" "}
                <strong>{context.bias}</strong>
              </p>
              <p>
                EMA20 {fmt(context.ema20)} · EMA50 {fmt(context.ema50)}
              </p>
              <p>RSI14 {fmt(context.rsi14)}</p>
              <small>
                Based on {context.bars} completed source candles.{" "}
                {context.status === "stale" || !fresh
                  ? "Source is stale; these are historical readings."
                  : ""}
              </small>
            </>
          ) : (
            <p>At least 50 completed source candles are required.</p>
          )}
        </section>
        <section className="panel content-panel">
          <h3>Support & resistance</h3>
          {ready ? (
            <>
              <p>
                Confirmed support: <strong>{fmt(context.support)}</strong>
              </p>
              <p>
                Confirmed resistance: <strong>{fmt(context.resistance)}</strong>
              </p>
              <small>
                Nearest confirmed pivots in the available history. A level is
                not a guaranteed reversal.
              </small>
            </>
          ) : (
            <p>Insufficient source history for confirmed levels.</p>
          )}
        </section>
        <section className="panel content-panel">
          <h3>Volatility & data coverage</h3>
          {ready ? (
            <p>
              ATR14: <strong>{fmt(context.atr14)}</strong> price units
            </p>
          ) : (
            <p>Volatility unavailable until enough history arrives.</p>
          )}
          <p>
            Order-book and aggressive buy/sell flow are not inferred from candle
            colours.
          </p>
          <small>
            No confidence percentage or guaranteed outcome is generated.
          </small>
        </section>
      </div>
      <OfficialNewsPanel />
    </>
  );
}
