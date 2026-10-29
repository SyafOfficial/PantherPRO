import { startObservation } from "@/app/admin/actions";
import { malaysiaTime } from "@/lib/market-data";
type Quote = {
  id: string;
  provider_id: string;
  source_name: string;
  bid: number;
  ask: number;
  observed_at: string;
};
export default function ObservationControl({
  signal,
  quotes,
}: {
  signal: Record<string, unknown>;
  quotes: Quote[];
}) {
  if (signal.status !== "active") return null;
  if (signal.observation_quote_id)
    return (
      <div className="message">
        Quote observation: {String(signal.reconciliation_state)}. Price touches
        do not establish broker execution or verified profit.
      </div>
    );
  return (
    <details className="admin-editor">
      <summary>Start licensed quote observation</summary>
      <form action={startObservation} className="form">
        <input name="id" type="hidden" value={String(signal.id)} />
        <p>
          This starts the documented quote-touch model from a fresh, permitted
          quote after publication. It never places an order. Targets and
          favorable movement are observations, not broker fills. Gaps halt
          observation.
        </p>
        <label>
          Source quote
          <select name="quote_id" required disabled={!quotes.length}>
            {!quotes.length && (
              <option value="">No permitted quotes available</option>
            )}
            {quotes.map((q) => (
              <option value={q.id} key={q.id}>
                {q.source_name} · bid {q.bid} / ask {q.ask} ·{" "}
                {malaysiaTime(q.observed_at)} MYT
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" disabled={!quotes.length}>
          Review & start observation
        </button>
      </form>
    </details>
  );
}
