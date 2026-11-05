export function performanceRange(from?: string, to?: string, now = Date.now()) {
  const day = 86400000;
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  const end = to ?? today;
  const start =
    from ?? new Date(Date.parse(today) - 29 * day).toISOString().slice(0, 10);
  if (!valid(start) || !valid(end)) throw new Error("Choose valid dates.");
  const fromTime = Date.parse(start) - 8 * 3600000;
  const toTime = Date.parse(end) + day - 8 * 3600000;
  if (toTime <= fromTime || toTime - fromTime > 366 * day)
    throw new Error("Choose a date range up to 366 days.");
  return {
    from: start,
    to: end,
    fromTime: new Date(fromTime).toISOString(),
    toTime: new Date(toTime).toISOString(),
  };
}
export type PerformanceSummary = {
  signals: number;
  active: number;
  closed: number;
  wins: number;
  losses: number;
  be: number;
  unclassified: number;
  running_50: number;
  tp1_hits: number;
  tp2_hits: number;
  tp3_hits: number;
  sl_hits: number;
  be_alerts: number;
  tp_pips: number;
  sl_pips: number;
  running_pips: number;
  total_pips: number;
  win_rate: number | null;
};
export type SetupPerformance = PerformanceSummary & {
  strategy: string;
  timeframe: string;
  higher_timeframe: string;
};
export type SignalPerformance = {
  id: string;
  published_at: string;
  closed_at: string | null;
  strategy: string | null;
  timeframe: string | null;
  higher_timeframe: string | null;
  direction: string;
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  status: string;
  tp1_hit_at: string | null;
  tp2_hit_at: string | null;
  tp3_hit_at: string | null;
  sl_hit_at: string | null;
  be_alert: boolean;
  be_alert_at: string | null;
  be_exit_at: string | null;
  monitoring_gap: boolean;
  outcome: string;
  highest_tp: number;
  total_pips: number;
};
export type PerformanceReport = {
  summary: PerformanceSummary;
  by_setup: SetupPerformance[];
  signals: SignalPerformance[];
  details_limit: number;
  as_of: string;
};
