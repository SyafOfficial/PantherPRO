import StrategyFields from "./strategy-fields";
import { reviseSignal } from "@/app/admin/actions";
export default function SignalEditor({
  signal: s,
}: {
  signal: Record<string, unknown>;
}) {
  if (s.status === "closed") return null;
  const active = s.status === "active";
  return (
    <details className="admin-editor">
      <summary>Review & edit signal · revision {String(s.version)}</summary>
      <form action={reviseSignal} className="form">
        <input type="hidden" name="id" value={String(s.id)} />
        <input type="hidden" name="version" value={String(s.version)} />
        <p>
          Published entry, direction and audience are fixed. Changes to active
          stops or targets notify eligible members. Every revision is audited.
        </p>
        <StrategyFields signal={s} locked={active} />
        <div className="admin-editor-grid">
          {active ? (
            <>
              <input
                type="hidden"
                name="direction"
                value={String(s.direction)}
              />
              <input type="hidden" name="access" value={String(s.access)} />
            </>
          ) : (
            <>
              <label>
                Direction
                <select name="direction" defaultValue={String(s.direction)}>
                  <option>BUY</option>
                  <option>SELL</option>
                </select>
              </label>
              <label>
                Audience
                <select name="access" defaultValue={String(s.access)}>
                  <option value="public">Public</option>
                  <option value="vip">VIP</option>
                </select>
              </label>
            </>
          )}
          {[
            ["entry", "Entry"],
            ["stop_loss", "Stop loss"],
            ["tp1", "Target 1"],
            ["tp2", "Target 2"],
            ["tp3", "Target 3"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                defaultValue={Number(s[key])}
                type="number"
                min="0.01"
                step="0.01"
                required
                readOnly={active && key === "entry"}
              />
            </label>
          ))}
        </div>
        <label>
          Signal reasoning
          <textarea
            name="reasoning"
            defaultValue={String(s.reasoning)}
            minLength={20}
            maxLength={2000}
            required
          />
        </label>
        <label>
          Reason for this revision
          <textarea
            name="revision_reason"
            minLength={10}
            maxLength={500}
            required
          />
        </label>
        <button className="primary-button">Approve & save revision</button>
      </form>
    </details>
  );
}
