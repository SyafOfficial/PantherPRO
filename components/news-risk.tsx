import type { CalendarEvent } from "@/lib/market-data";
import { malaysiaTime } from "@/lib/market-data";
import { newsRisk, newsProfile } from "@/lib/news-context";
import { CalendarDays } from "lucide-react";
export default function NewsRisk({
  events,
  now,
}: {
  events: CalendarEvent[];
  now: number;
}) {
  const risk = newsRisk(events, now);
  return (
    <section
      className={`panel news-risk risk-${risk.state}`}
      aria-label="XAUUSD signal news risk"
    >
      <div className="section-title">
        <h2>
          <CalendarDays size={17} /> XAUUSD news watch
        </h2>
        <span className="outline-tag">
          {risk.state.replaceAll("_", " ").toUpperCase()}
        </span>
      </div>
      <p>{risk.message}</p>
      {risk.source_freshness_unverified && (
        <p>
          Source freshness is unverified. Confirm the timing with an authorized
          current source.
        </p>
      )}
      {risk.events.map((event) => (
        <a
          href={`/?view=Economic%20Calendar&event=${event.id}`}
          className="news-risk-event"
          key={event.id}
        >
          <span>
            <strong>{event.name}</strong>
            <small>
              {newsProfile(event.name).label} · {event.source_name}
            </small>
          </span>
          <span>{malaysiaTime(event.event_time)} MYT</span>
        </a>
      ))}
      <small>
        Context only. News does not automatically publish a signal or block an
        administrator-reviewed setup.
      </small>
    </section>
  );
}
