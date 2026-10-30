export const STRATEGIES = ["QM", "BOS", "CHOCH", "TRENDLINE"] as const;
export const TIMEFRAMES = ["M15", "M30", "H1", "H4", "W1", "MN1"] as const;
export const TIMEFRAME_MINUTES = {
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
  MN1: 44640, // Ordering only; calendar-month candles are never treated as fixed 31-day bars.
} as const;
export const STRATEGY_LABELS = {
  QM: "QM · Quasimodo",
  BOS: "BOS · Break of Structure",
  CHOCH: "CHOCH · Change of Character",
  TRENDLINE: "Trendline",
};
