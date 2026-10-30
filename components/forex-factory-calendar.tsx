"use client";
import { useEffect, useState } from "react";
import type { ForexFactoryCalendar } from "@/lib/forex-factory";
import { malaysiaTime } from "@/lib/market-data";

export default function ForexFactoryCalendarPanel() {
  const [calendar, setCalendar] = useState<ForexFactoryCalendar | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | null = null;
    async function poll() {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 60000);
        return;
      }
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), 10000);
      try {
        const response = await fetch("/api/context/calendar", {
          cache: "no-store",
          signal: active.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const value: ForexFactoryCalendar = await response.json();
        if (!stopped) {
          setCalendar(value);
          setFailed(false);
        }
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        clearTimeout(timeout);
      }
      if (!stopped) timer = setTimeout(poll, 60000);
    }
    void poll();
    return () => {
      stopped = true;
      active?.abort();
      clearTimeout(timer);
    };
  }, []);
  return (
    <section aria-label="Forex Factory economic calendar">
      <div className="panel content-panel">
        <h2>Forex Factory · USD calendar</h2>
        <p>
          This week’s USD releases, shown in Malaysia time. The source is
          checked hourly; actual figures appear only when supplied by the feed.
        </p>
        <a
          href="https://www.forexfactory.com/calendar"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Forex Factory ↗
        </a>
        {failed && (
          <p role="status">
            Calendar feed unavailable. Any previously loaded records may be
            outdated.
          </p>
        )}
        {!calendar && !failed && <p>Loading calendar…</p>}
        {calendar && <p>Retrieved {malaysiaTime(calendar.fetched_at)} MYT</p>}
        {calendar?.events.length === 0 && (
          <p>No USD events were supplied for this week.</p>
        )}
      </div>
      <div className="calendar-list">
        {calendar?.events.map((event) => (
          <article className="panel calendar-event" key={event.id}>
            <div className="section-title">
              <div>
                <div className="eyebrow">USD</div>
                <h2>{event.name}</h2>
                <p>{malaysiaTime(event.event_time)} MYT</p>
              </div>
              <span className="outline-tag">
                {event.importance.toUpperCase()}
                {event.importance === "holiday" ? "" : " IMPACT"}
              </span>
            </div>
            <div className="calendar-figures">
              {[
                ["Previous", event.previous],
                ["Forecast", event.forecast],
                ["Actual", event.actual],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value ?? "Not supplied"}</strong>
                </div>
              ))}
            </div>
            <p>
              Source: Forex Factory · Calendar context does not predict XAUUSD
              direction.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
