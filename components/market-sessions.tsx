"use client";
import { useMemo } from "react";
import { Globe2 } from "lucide-react";
import { marketSessions, sessionCountdown } from "@/lib/market-sessions";

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const date = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  weekday: "short",
  day: "numeric",
  month: "short",
});

export default function MarketSessions({ now }: { now: number }) {
  const minute = Math.floor(now / 60000) * 60000;
  const sessions = useMemo(() => marketSessions(minute), [minute]);
  const open = sessions.filter((session) => session.open);
  const summary =
    open.length > 1
      ? `${open.map((session) => session.name).join(" & ")} overlap`
      : open.length
        ? `${open[0].name} session is open`
        : "Between scheduled sessions";
  return (
    <section className="panel market-sessions" aria-label="Market sessions">
      <div className="section-title">
        <div>
          <h2>
            <Globe2 size={17} /> Market sessions
          </h2>
          <p>Follow the trading day, session by session.</p>
        </div>
        <span className="outline-tag">MYT · UTC+8</span>
      </div>
      <div className="market-session-grid">
        {sessions.map((session) => {
          const progress = session.open
            ? Math.min(
                100,
                Math.max(
                  0,
                  ((now - session.start) / (session.end - session.start)) * 100,
                ),
              )
            : 0;
          const overnight =
            date.format(session.start) !== date.format(session.end);
          return (
            <article
              className={`market-session-card${session.open ? " is-open" : ""}`}
              key={session.name}
            >
              <div className="market-session-title">
                <h3>{session.name}</h3>
                <span className="market-session-status">
                  {session.open ? "Open" : "Closed"}
                </span>
              </div>
              <progress
                value={progress}
                max={100}
                aria-label={`${session.name} session progress`}
              />
              <p className="market-session-hours">
                {clock.format(session.start)} – {clock.format(session.end)}
                {overnight && <small>Next day</small>}
              </p>
              <p className="market-session-date">
                {session.open ? "Session" : "Next"} ·{" "}
                {date.format(session.start)}
              </p>
              <span className="market-session-countdown">
                {session.open ? "Closes" : "Opens"} in{" "}
                {sessionCountdown(
                  (session.open ? session.end : session.start) - now,
                )}
              </span>
            </article>
          );
        })}
      </div>
      <p className="market-session-summary">
        <span className={`dot ${open.length ? "" : "muted-dot"}`} />
        {summary}
      </p>
      <small className="market-session-note">
        Indicative weekday FX sessions. Local daylight saving is applied
        automatically. Holidays and broker trading hours may differ; overlap
        does not confirm high volatility.
      </small>
    </section>
  );
}
