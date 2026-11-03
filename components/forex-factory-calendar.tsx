"use client";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import type { ForexFactoryCalendar } from "@/lib/forex-factory";
import { malaysiaTime } from "@/lib/market-data";
import {
  malaysiaDay,
  shiftCalendarDay,
  dailyCalendar,
  calendarWeekOutdated,
  type ImpactFilter,
} from "@/lib/calendar-day";

export default function ForexFactoryCalendarPanel() {
  const [calendar, setCalendar] = useState<ForexFactoryCalendar | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactFilter>("all");
  const today = malaysiaDay(now),
    day = selectedDay ?? today;
  const daily = dailyCalendar(calendar?.events ?? [], day, impact);
  const outdated = calendarWeekOutdated(calendar?.events ?? [], today);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false,
      fetching = false;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | null = null;
    async function poll() {
      if (stopped || fetching) return;
      clearTimeout(timer);
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 60000);
        return;
      }
      fetching = true;
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
        fetching = false;
      }
      if (!stopped) timer = setTimeout(poll, 60000);
    }
    const resume = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void poll();
    };
    const clock = setInterval(() => setNow(Date.now()), 30000);
    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => {
      stopped = true;
      active?.abort();
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [retry]);
  const dateLabel = new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${day}T12:00:00+08:00`));
  const timeLabel = (t: string) =>
    new Intl.DateTimeFormat("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(t));
  return (
    <section
      aria-label="Daily XAUUSD economic calendar"
      className="daily-calendar"
    >
      <div className="panel daily-calendar-header">
        <div className="section-title">
          <div>
            <div className="eyebrow">XAUUSD · ECONOMIC CALENDAR</div>
            <h2>
              {selectedDay === null ? "Today's market events" : "Market events"}
            </h2>
            <p>{dateLabel}</p>
          </div>
          <span className="outline-tag">
            <Clock3 size={12} /> MYT · UTC+8
          </span>
        </div>
        <p className="daily-calendar-intro">
          USD releases relevant to gold. Impact ratings follow the source.
        </p>
        <div className="calendar-day-controls">
          <div className="calendar-date-switch">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => setSelectedDay(shiftCalendarDay(day, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <label>
              <span className="sr-only">Calendar date in Malaysia time</span>
              <input
                aria-label="Calendar date in Malaysia time"
                type="date"
                value={day}
                onChange={(e) => {
                  if (e.target.value) setSelectedDay(e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              aria-label="Next day"
              onClick={() => setSelectedDay(shiftCalendarDay(day, 1))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSelectedDay(null)}
            aria-pressed={selectedDay === null}
          >
            Today
          </button>
        </div>
        <div className="calendar-impact-summary">
          {(["high", "medium", "low"] as const).map((level) => (
            <button
              type="button"
              className={`impact-summary impact-${level}`}
              key={level}
              onClick={() => setImpact(impact === level ? "all" : level)}
              aria-pressed={impact === level}
            >
              <span>{level.toUpperCase()} IMPACT</span>
              <strong>
                {calendar
                  ? daily.counts[level].toString().padStart(2, "0")
                  : "—"}
              </strong>
            </button>
          ))}
        </div>
        <div
          className="calendar-impact-filters"
          role="group"
          aria-label="Filter by news impact"
        >
          {(["all", "high", "medium", "low"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={impact === value}
              onClick={() => setImpact(value)}
            >
              {value === "all"
                ? "All events"
                : `${value[0].toUpperCase()}${value.slice(1)} impact`}
            </button>
          ))}
        </div>
        <div className="calendar-update-line">
          <span>
            {calendar
              ? `${calendar.source_name} · checked ${malaysiaTime(calendar.fetched_at)} MYT`
              : failed
                ? "Calendar source unavailable"
                : "Loading saved calendar…"}
          </span>
          <a
            href={
              calendar?.source_url ?? "https://www.forexfactory.com/calendar"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            View source ↗
          </a>
        </div>
        <small>
          Today rolls over automatically at midnight MYT. Source refresh:{" "}
          {calendar ? calendar.refresh_seconds / 60 : 60} min.
        </small>
        {failed && (
          <p className="calendar-feed-warning" role="status">
            Unable to refresh the source. Last loaded events may be outdated.
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setFailed(false);
                setRetry((n) => n + 1);
              }}
            >
              Retry now
            </button>
          </p>
        )}
        {calendar?.cache_status === "stale" && (
          <p className="calendar-feed-warning" role="status">
            Showing the last verified schedule. Background refresh is pending.
          </p>
        )}
        {outdated && (
          <p className="calendar-feed-warning" role="status">
            The source still contains an earlier week's schedule. Awaiting its
            new calendar.
          </p>
        )}
      </div>
      {!calendar && !failed && (
        <div className="panel calendar-day-empty">
          <CalendarDays size={26} />
          <h3>Loading the day's schedule</h3>
          <p>Retrieving source events and impact ratings.</p>
        </div>
      )}
      {calendar && daily.events.length === 0 && (
        <div className="panel calendar-day-empty">
          <CalendarDays size={26} />
          <h3>
            {daily.total
              ? "No events match this impact"
              : "No events supplied for this date"}
          </h3>
          <p>
            {daily.total
              ? "Select All events to see the day's schedule."
              : "Check another date. An empty source schedule does not mean the market is risk-free."}
          </p>
        </div>
      )}
      <div className="daily-event-list">
        {daily.events.map((event) => (
          <article
            className={`panel daily-event impact-${event.importance}`}
            key={event.id}
          >
            <div className="daily-event-time">
              <strong>{timeLabel(event.event_time)}</strong>
              <span>MYT</span>
            </div>
            <div className="daily-event-content">
              <div className="daily-event-labels">
                <span className="outline-tag">USD</span>
                <span className={`news-impact impact-${event.importance}`}>
                  {event.importance.toUpperCase()}
                  {event.importance === "holiday" ? "" : " IMPACT"}
                </span>
                <span className="daily-event-state">
                  {Date.parse(event.event_time) > now
                    ? "UPCOMING"
                    : event.actual
                      ? "ACTUAL SUPPLIED"
                      : "SCHEDULED TIME PASSED"}
                </span>
              </div>
              <h3>{event.name}</h3>
              <div className="calendar-figures">
                {[
                  ["Previous", event.previous],
                  ["Forecast", event.forecast],
                  ["Actual", event.actual],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value ?? "—"}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      {calendar && (
        <p className="daily-calendar-footnote">
          — = not supplied. Calendar context does not predict XAUUSD direction.
        </p>
      )}
    </section>
  );
}
