import { STRATEGIES, TIMEFRAMES, STRATEGY_LABELS } from "@/lib/strategy";
export default function StrategyFields({
  signal = {},
  locked = false,
  required = false,
}: {
  signal?: Record<string, unknown>;
  locked?: boolean;
  required?: boolean;
}) {
  if (locked)
    return (
      <>
        <input
          name="strategy"
          type="hidden"
          value={String(signal.strategy ?? "")}
        />
        <input
          name="timeframe"
          type="hidden"
          value={String(signal.timeframe ?? "")}
        />
        <input
          name="higher_timeframe"
          type="hidden"
          value={String(signal.higher_timeframe ?? "")}
        />
        <p>
          Method: {String(signal.strategy ?? "Unclassified")} · setup{" "}
          {String(signal.timeframe ?? "Not supplied")} · higher context{" "}
          {String(signal.higher_timeframe ?? "Not supplied")}. Published method
          tags are fixed.
        </p>
      </>
    );
  return (
    <>
      <label>
        Strategy
        <select
          name="strategy"
          defaultValue={String(signal.strategy ?? "")}
          required={required}
        >
          <option value="">Select method</option>
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {STRATEGY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Setup timeframe
        <select
          name="timeframe"
          defaultValue={String(signal.timeframe ?? "")}
          required={required}
        >
          <option value="">Select timeframe</option>
          {TIMEFRAMES.map((t) => (
            <option value={t} key={t}>
              {t === "W1" ? "W1 · Weekly" : t === "D1" ? "D1 · Daily" : t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Higher timeframe context
        <select
          name="higher_timeframe"
          defaultValue={String(signal.higher_timeframe ?? "")}
        >
          <option value="">Not supplied</option>
          {TIMEFRAMES.map((t) => (
            <option value={t} key={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <small>
        Context must be higher than the setup timeframe. Labels describe an
        administrator-reviewed method; automated detection is not connected.
      </small>
    </>
  );
}
