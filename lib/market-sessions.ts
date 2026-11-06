const HOUR = 3600000;
const DAY = 24 * HOUR;

// Indicative weekday FX dealing sessions in each financial centre's local time.
// These are session schedules, not broker trading availability or measured volatility.
const DEFINITIONS = [
  { name: "Sydney", zone: "Australia/Sydney", openHour: 8, closeHour: 17 },
  { name: "Tokyo", zone: "Asia/Tokyo", openHour: 9, closeHour: 18 },
  { name: "London", zone: "Europe/London", openHour: 8, closeHour: 17 },
  { name: "New York", zone: "America/New_York", openHour: 8, closeHour: 17 },
] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(at: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  const fields = Object.fromEntries(
    formatter.formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    year: +fields.year,
    month: +fields.month,
    day: +fields.day,
    hour: +fields.hour,
    minute: +fields.minute,
    second: +fields.second,
  };
}

function localHour(date: Date, hour: number, zone: string) {
  const wall = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
  );
  let utc = wall;
  // IANA timezone offsets are resolved for the session date, including DST.
  for (let i = 0; i < 3; i++) {
    const p = localParts(utc, zone);
    const represented = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    utc = wall - (represented - utc);
  }
  return utc;
}

export function marketSessions(now: number) {
  if (!Number.isFinite(now)) throw new Error("Invalid market session time");
  return DEFINITIONS.map((definition) => {
    const local = localParts(now, definition.zone);
    const midnight = Date.UTC(local.year, local.month - 1, local.day);
    const windows = Array.from(
      { length: 10 },
      (_, i) => new Date(midnight + (i - 1) * DAY),
    )
      .filter((day) => day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
      .map((day) => ({
        start: localHour(day, definition.openHour, definition.zone),
        end: localHour(day, definition.closeHour, definition.zone),
      }));
    const active = windows.find(
      (window) => now >= window.start && now < window.end,
    );
    const window = active ?? windows.find((window) => window.start > now)!;
    return {
      name: definition.name,
      zone: definition.zone,
      open: Boolean(active),
      ...window,
    };
  });
}

export function sessionCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return days
    ? `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
    : `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
}
