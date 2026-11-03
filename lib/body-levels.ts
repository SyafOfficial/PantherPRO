import type { MT5Display } from "./engine/display";
type Bar = MT5Display["bars"][number];
export type BodyLevel = {
  kind: "support" | "resistance";
  price: number;
  originOpenedAt: number;
  confirmedOpenedAt: number;
  departure: number;
};
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2
    : 0;
};
/** Completed close pivots that originate a directional body displacement and close break.
 * Wicks neither define a level nor invalidate it. Confirmation uses observed bars only.
 */
export function bodyOriginLevels(bars: Bar[], price: number) {
  const levels: BodyLevel[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const origin = bars[i];
    const neighbours = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]];
    const baseline = Math.max(
      0.01,
      median(
        bars
          .slice(Math.max(0, i - 14), i)
          .map((b) => Math.abs(b.close - b.open)),
      ),
    );
    for (const kind of ["support", "resistance"] as const) {
      const sign = kind === "support" ? 1 : -1;
      if (!neighbours.every((b) => sign * (b.close - origin.close) > 0))
        continue;
      if (sign * (price - origin.close) <= 0) continue;
      const left =
        kind === "support"
          ? Math.max(bars[i - 2].close, bars[i - 1].close)
          : Math.min(bars[i - 2].close, bars[i - 1].close);
      const confirmation = bars.slice(i + 2, i + 7).findIndex((b, j) => {
        const departure = sign * (b.close - origin.close);
        const impulse = bars
          .slice(i + 1, i + 3 + j)
          .some((x) => sign * (x.close - x.open) >= 2 * baseline);
        return (
          departure >= 2 * baseline && sign * (b.close - left) > 0 && impulse
        );
      });
      if (confirmation < 0) continue;
      const confirmed = i + 2 + confirmation;
      if (bars.slice(i + 1).some((b) => sign * (b.close - origin.close) < 0))
        continue;
      levels.push({
        kind,
        price: origin.close,
        originOpenedAt: origin.opened_at_server_raw,
        confirmedOpenedAt: bars[confirmed].opened_at_server_raw,
        departure: Math.abs(bars[confirmed].close - origin.close),
      });
    }
  }
  // Latest qualifying origin explains the recent move; price proximity alone never qualifies.
  const latest = (kind: BodyLevel["kind"]) =>
    levels
      .filter((l) => l.kind === kind)
      .sort(
        (a, b) =>
          b.originOpenedAt - a.originOpenedAt ||
          Math.abs(a.price - price) - Math.abs(b.price - price),
      )[0] ?? null;
  return { support: latest("support"), resistance: latest("resistance") };
}
