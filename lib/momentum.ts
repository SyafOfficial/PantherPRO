export type MarketBias = "bullish" | "bearish" | "mixed";
export function rsiMomentum(value: number, bias: MarketBias) {
  if (!Number.isFinite(value) || value < 0 || value > 100)
    throw new Error("RSI must be between 0 and 100");
  const direction = value > 50 ? "bullish" : value < 50 ? "bearish" : "neutral";
  const zone = value >= 70 ? "high" : value <= 30 ? "low" : "normal";
  const alignment =
    direction === "neutral" || bias === "mixed"
      ? "unconfirmed"
      : direction === bias
        ? "aligned"
        : "against_bias";
  return { direction, zone, alignment };
}
