/** Owner-defined counter window in MYT, independent of broker/DST market hours. */
const MYT_OFFSET = 8 * 3600000;
const DAY = 24 * 3600000;
export function signalSession(now: number) {
  if (!Number.isFinite(now)) throw new Error("Invalid session time");
  const local = new Date(now + MYT_OFFSET);
  const midnight =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    MYT_OFFSET;
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const betweenSessions = minute >= 330 && minute < 360;
  const start = midnight + 6 * 3600000 - (minute < 330 ? DAY : 0);
  const reset = start + 23.5 * 3600000;
  return {
    start,
    reset,
    betweenSessions,
    nextBoundary: betweenSessions ? start : reset,
  };
}
export type DailySignalSummary = {
  count: number;
  active_count: number;
  session_start: string;
  session_reset: string;
  as_of: string;
};
export function visibleDailyCount(
  summary: DailySignalSummary | null,
  now: number,
) {
  if (!summary) return null;
  const window = signalSession(now);
  if (
    window.betweenSessions ||
    Date.parse(summary.session_start) !== window.start ||
    now >= Date.parse(summary.session_reset)
  )
    return 0;
  return Math.max(0, summary.count);
}
