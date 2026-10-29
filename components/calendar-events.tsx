import { newsProfile } from "@/lib/news-context";
import type { CalendarEvent } from "@/lib/market-data";
import { malaysiaTime } from "@/lib/market-data";
export default function CalendarEvents({
  events,
}: {
  events: CalendarEvent[];
}) {
  if (!events.length)
    return (
      <div className="panel empty-state">
        <h3>Awaiting licensed calendar data</h3>
        <p>
          No release dates, forecasts or actual figures are available. Connect a
          licensed provider before using this calendar.
        </p>
        <span className="outline-tag">NO PROVIDER DATA</span>
      </div>
    );
  return (
    <div className="calendar-list">
      {events.map((event) => (
        <article
          className="panel calendar-event"
          id={`event-${event.id}`}
          key={event.id}
        >
          <div className="section-title">
            <div>
              <div className="eyebrow">
                {event.country} · {event.currency}
              </div>
              <h2>{event.name}</h2>
              <p>{malaysiaTime(event.event_time)} MYT</p>
            </div>
            <span className="outline-tag">
              {event.importance.toUpperCase()} IMPACT
            </span>
          </div>
          <div className="calendar-figures">
            {[
              ["Previous", event.previous],
              ["Consensus", event.forecast],
              ["Actual", event.actual],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value ?? "Not available"}</strong>
              </div>
            ))}
          </div>
          <div className="calendar-provenance">
            <a
              href={event.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {event.source_name} ↗
            </a>
            <span>
              Source updated {malaysiaTime(event.source_updated_at)} MYT ·
              revision {event.version}
            </span>
          </div>
          <p className="calendar-impact">
            {newsProfile(event.name).focus} No guaranteed XAUUSD reaction is
            implied.
          </p>
        </article>
      ))}
    </div>
  );
}
