import { quoteFreshness } from "./market-data";
import { confirmedPivots, detectStructure } from "./engine/structure";
import type { MT5Display } from "./engine/display";
function ema(values: number[], period: number) {
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const value of values.slice(period))
    result += ((value - result) * 2) / (period + 1);
  return result;
}
function rsi(values: number[], period = 14) {
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    gain += Math.max(0, delta) / period;
    loss += Math.max(0, -delta) / period;
  }
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, delta)) / period;
    loss = (loss * (period - 1) + Math.max(0, -delta)) / period;
  }
  return gain === 0 && loss === 0
    ? 50
    : loss === 0
      ? 100
      : 100 - 100 / (1 + gain / loss);
}
export function marketContext(data: MT5Display, now: number) {
  if (data.bars.length < 50)
    return {
      status: "insufficient_history" as const,
      timeframe: data.timeframe,
      source: data.quote.source_name,
    };
  const closes = data.bars.map((b) => b.close),
    fast = ema(closes, 20),
    slow = ema(closes, 50),
    structure = detectStructure(data.bars).trend,
    pivots = confirmedPivots(data.bars);
  const support =
    pivots
      .filter((p) => p.kind === "low" && p.price < data.quote.bid)
      .sort((a, b) => b.price - a.price)[0]?.price ?? null;
  const resistance =
    pivots
      .filter((p) => p.kind === "high" && p.price > data.quote.bid)
      .sort((a, b) => a.price - b.price)[0]?.price ?? null;
  const ranges = data.bars
    .slice(1)
    .map((b, i) =>
      Math.max(
        b.high - b.low,
        Math.abs(b.high - data.bars[i].close),
        Math.abs(b.low - data.bars[i].close),
      ),
    );
  let atr = ranges.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (const value of ranges.slice(14)) atr = (atr * 13 + value) / 14;
  return {
    status: quoteFreshness(data.quote, now)
      ? ("ready" as const)
      : ("stale" as const),
    timeframe: data.timeframe,
    source: data.quote.source_name,
    asOf: data.exported_at,
    structure,
    bias:
      structure === "up" && fast > slow
        ? "bullish"
        : structure === "down" && fast < slow
          ? "bearish"
          : "mixed",
    ema20: fast,
    ema50: slow,
    rsi14: rsi(closes),
    atr14: atr,
    support,
    resistance,
    bars: data.bars.length,
    meaning: "Closed-candle context only; not an entry signal or prediction.",
  };
}
