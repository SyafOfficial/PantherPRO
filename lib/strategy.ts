export const STRATEGIES = ["QM", "BOS", "CHOCH", "TRENDLINE"] as const;
export const TIMEFRAMES = ["M30", "H1", "H4", "D1", "W1"] as const;
export const TIMEFRAME_MINUTES = {
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
} as const;
export const STRATEGY_LABELS = {
  QM: "QM · Quasimodo",
  BOS: "BOS · Break of Structure",
  CHOCH: "CHOCH · Change of Character",
  TRENDLINE: "Trendline",
};
