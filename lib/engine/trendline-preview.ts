import { confirmedPivots } from "./structure";
import { VESTRADO_RULES } from "./config";

/** Pure detector; publication is handled separately by the live adapter. */
export const TRENDLINE_PREVIEW_VERSION = "trendline-v2";
export type TrendlineBar = {
  opened_at_server_raw: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
export type TrendlineProposal = {
  version: typeof TRENDLINE_PREVIEW_VERSION;
  subtype: "bounce" | "breakout_retest";
  direction: "BUY" | "SELL";
  anchors: [number, number];
  eventOpened: number;
  confirmationOpened: number;
  lineAtEvent: number;
  lineAtConfirmation: number;
  zoneLow: number;
  zoneHigh: number;
  entry: number;
  stop: number;
  stopBuffer: number;
  target: number;
  rewardRisk: number;
};
// Provisional research parameters, not optimized or validated profitability claims.
export const TRENDLINE_PREVIEW_POLICY = Object.freeze({
  atrPeriod: 14,
  anchorSpacing: 5,
  maxSlopeAtrPerBar: 0.5,
  lineToleranceAtr: 0.1,
  eventBodyAtr: 0.35,
  confirmationBodyAtr: 0.25,
  closePosition: 0.65,
  stopBufferAtr: 0.15,
  minimumRewardRisk: 1.5,
  maximumEventAgeBars: 3,
});
function validBars(bars: TrendlineBar[]) {
  return bars.every(
    (b, i) =>
      [b.opened_at_server_raw, b.open, b.high, b.low, b.close].every(
        Number.isFinite,
      ) &&
      b.opened_at_server_raw > 0 &&
      b.low > 0 &&
      b.low <= Math.min(b.open, b.close) &&
      b.high >= Math.max(b.open, b.close) &&
      (i === 0 || b.opened_at_server_raw > bars[i - 1].opened_at_server_raw),
  );
}
export function trendlineAtr(bars: TrendlineBar[]) {
  const n = TRENDLINE_PREVIEW_POLICY.atrPeriod;
  if (bars.length < n + 1 || !validBars(bars)) return null;
  const start = bars.length - n;
  let sum = 0;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i],
      previous = bars[i - 1].close;
    sum += Math.max(
      b.high - b.low,
      Math.abs(b.high - previous),
      Math.abs(b.low - previous),
    );
  }
  return sum > 0 ? sum / n : null;
}
function rejection(
  b: TrendlineBar,
  buy: boolean,
  atr: number,
  minimumBody: number,
) {
  const range = b.high - b.low;
  return (
    range > 0 &&
    Math.abs(b.close - b.open) >= atr * minimumBody &&
    (buy ? b.close > b.open : b.close < b.open) &&
    (buy ? (b.close - b.low) / range : (b.high - b.close) / range) >=
      TRENDLINE_PREVIEW_POLICY.closePosition
  );
}

/** All inputs are broker wall-time coordinates; caller supplies completed candles only.
 * setupBars ends at the event candle. Later setup candles are checked separately.
 * `target` is the nearest known intact obstacle, not an invented RR target.
 */
export function previewTrendline(input: {
  setupBars: TrendlineBar[];
  setupEnd: number;
  subsequentSetupBars: TrendlineBar[];
  m5Bars: TrendlineBar[];
  asOf: number;
  higherTrend: "up" | "down" | "range" | "unknown";
  bid: number;
  ask: number;
  point: number;
  target: { buy: number | null; sell: number | null };
}): TrendlineProposal[] {
  const { setupBars: bars, m5Bars, bid, ask, point } = input;
  const policy = TRENDLINE_PREVIEW_POLICY;
  if (
    bars.length < 20 ||
    m5Bars.length < 15 ||
    !validBars(bars) ||
    !validBars(m5Bars) ||
    !validBars(input.subsequentSetupBars) ||
    ![bid, ask, point, input.asOf, input.setupEnd].every(Number.isFinite) ||
    bid <= 0 ||
    ask < bid ||
    point <= 0
  )
    return [];
  const event = bars.at(-1)!,
    confirm = m5Bars.at(-1)!,
    previousM5 = m5Bars.at(-2)!;
  const step = input.setupEnd - event.opened_at_server_raw;
  if (
    step <= 0 ||
    input.setupEnd > confirm.opened_at_server_raw ||
    input.asOf < confirm.opened_at_server_raw + 300 ||
    input.asOf - (confirm.opened_at_server_raw + 300) > 300 ||
    input.asOf - input.setupEnd > step * policy.maximumEventAgeBars ||
    m5Bars.some((b) => b.opened_at_server_raw + 300 > input.asOf) ||
    input.subsequentSetupBars.some(
      (b) =>
        b.opened_at_server_raw < input.setupEnd ||
        b.opened_at_server_raw + step > input.asOf,
    )
  )
    return [];
  const atr = trendlineAtr(bars.slice(0, -1)),
    m5Atr = trendlineAtr(m5Bars.slice(0, -1));
  if (!atr || !m5Atr) return [];
  if (
    confirm.high - confirm.low >
    VESTRADO_RULES.maxZonePips * VESTRADO_RULES.pipSize
  )
    return [];
  const spread = ask - bid;
  // Reject quotes whose spread overwhelms the confirmation candle's normal range.
  if (spread > m5Atr * 0.25) return [];
  const tolerance = Math.max(point * 2, atr * policy.lineToleranceAtr, spread);
  const pivots = confirmedPivots(bars.slice(0, -1), 2);
  const result: TrendlineProposal[] = [];
  for (const rising of [true, false]) {
    const anchors = pivots
      .filter((p) => p.kind === (rising ? "low" : "high"))
      .slice(-2);
    if (anchors.length !== 2) continue;
    const [a, b] = anchors,
      dt = b.openedAtServer - a.openedAtServer;
    if (
      b.barIndex - a.barIndex < policy.anchorSpacing ||
      dt <= 0 ||
      !(rising ? b.price > a.price : b.price < a.price)
    )
      continue;
    const slope = (b.price - a.price) / dt;
    if (Math.abs(slope * step) > atr * policy.maxSlopeAtrPerBar) continue;
    const line = (time: number) => a.price + slope * (time - a.openedAtServer);
    const wrongSide = (c: TrendlineBar, buy: boolean) =>
      buy
        ? c.close < line(c.opened_at_server_raw) - tolerance
        : c.close > line(c.opened_at_server_raw) + tolerance;
    // The exact same line must have survived every completed candle since its first anchor.
    if (bars.slice(a.barIndex + 1, -1).some((c) => wrongSide(c, rising)))
      continue;
    const level = line(event.opened_at_server_raw);
    const touches = (c: TrendlineBar) =>
      c.low <= line(c.opened_at_server_raw) + tolerance &&
      c.high >= line(c.opened_at_server_raw) - tolerance;
    for (const subtype of ["bounce", "breakout_retest"] as const) {
      const buy = subtype === "bounce" ? rising : !rising;
      if (input.higherTrend !== (buy ? "up" : "down")) continue;
      const sign = buy ? 1 : -1;
      if (subtype === "bounce") {
        if (!touches(event) || sign * (event.close - level) <= tolerance)
          continue;
      } else {
        // A previously validated third touch is required before a line can break.
        if (
          !bars.slice(b.confirmedIndex + 1, -1).some(touches) ||
          sign * (event.close - level) <= tolerance ||
          sign *
            (bars.at(-2)!.close - line(bars.at(-2)!.opened_at_server_raw)) >
            tolerance
        )
          continue;
      }
      if (!rejection(event, buy, atr, policy.eventBodyAtr)) continue;
      // Never freeze a sloping line at the event/confirmation price.
      if (
        input.subsequentSetupBars.some((c) => wrongSide(c, buy)) ||
        m5Bars
          .filter(
            (c) => c.opened_at_server_raw >= input.setupEnd && c !== confirm,
          )
          .some((c) => wrongSide(c, buy))
      )
        continue;
      const currentLevel = line(confirm.opened_at_server_raw);
      if (
        currentLevel <= 0 ||
        !touches(confirm) ||
        sign * (confirm.close - currentLevel) <= Math.max(point * 2, spread) ||
        !rejection(confirm, buy, m5Atr, policy.confirmationBodyAtr) ||
        (buy
          ? confirm.close <= previousM5.high
          : confirm.close >= previousM5.low)
      )
        continue;
      const entry = buy ? ask : bid;
      if (entry < confirm.low || entry > confirm.high) continue;
      // Bounce invalidates beyond the second structural anchor. Breakout invalidates
      // beyond the broken-line event/retest extremes, never a widened stop after entry.
      const extreme =
        subtype === "bounce"
          ? buy
            ? Math.min(b.price, confirm.low)
            : Math.max(b.price, confirm.high)
          : buy
            ? Math.min(event.low, confirm.low)
            : Math.max(event.high, confirm.high);
      const buffer = Math.max(
        atr * policy.stopBufferAtr,
        spread * 2,
        point * 2,
      );
      const stop = extreme - sign * buffer;
      const target = buy ? input.target.buy : input.target.sell;
      const risk = sign * (entry - stop);
      if (target == null || !Number.isFinite(target) || stop <= 0 || risk <= 0)
        continue;
      // Measure from the least favorable edge, not an optimistic entry in the zone.
      const worstEntry = buy ? confirm.high : confirm.low;
      const rewardRisk =
        (sign * (target - worstEntry)) / (sign * (worstEntry - stop));
      if (rewardRisk < policy.minimumRewardRisk) continue;
      result.push({
        version: TRENDLINE_PREVIEW_VERSION,
        subtype,
        direction: buy ? "BUY" : "SELL",
        anchors: [a.openedAtServer, b.openedAtServer],
        eventOpened: event.opened_at_server_raw,
        confirmationOpened: confirm.opened_at_server_raw,
        lineAtEvent: level,
        lineAtConfirmation: currentLevel,
        zoneLow: confirm.low,
        zoneHigh: confirm.high,
        entry,
        stop,
        stopBuffer: buffer,
        target,
        rewardRisk,
      });
    }
  }
  return result;
}
