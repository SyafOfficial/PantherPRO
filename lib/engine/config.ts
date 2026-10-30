// Owner-confirmed on 30 October 2026: 4000 -> 4005 is 50 pips.
// These are price-distance rules, independent of client lot size or profit.
export const VESTRADO_RULES = Object.freeze({
  symbol: "XAUUSD.V",
  pipSize: 0.1,
  maxZonePips: 80,
  slBufferPips: 30,
  partialPips: 50 as const,
  stopConfirmation: "M5_CLOSE" as const,
  allowedSetupFrames: ["M15", "M30", "H1", "H4", "W1", "MN1"] as const,
  autoPublish: false,
});
export function priceDistance(pips: number) {
  if (!Number.isFinite(pips) || pips < 0)
    throw new Error("Invalid pip distance");
  return pips * VESTRADO_RULES.pipSize;
}
