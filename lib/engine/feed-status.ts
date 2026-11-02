export function feedStatus(
  row: {
    received_at: string;
    exported_at: string;
    server_time?: unknown;
    tick_time?: unknown;
  } | null,
  now: number,
) {
  if (!row) return { status: "unavailable" as const };
  const received = Date.parse(row.received_at),
    exported = Date.parse(row.exported_at);
  if (
    !Number.isFinite(received) ||
    !Number.isFinite(exported) ||
    received > now ||
    exported > now
  )
    return { status: "invalid_timestamps" as const };
  const tickAge =
    typeof row.server_time === "number" && typeof row.tick_time === "number"
      ? row.server_time - row.tick_time
      : null;
  return {
    tick_age_seconds: tickAge,
    quote_usable:
      tickAge !== null &&
      tickAge >= 0 &&
      tickAge <= 60 &&
      now - received <= 30000 &&
      now - exported <= 30000,
    status:
      now - received <= 30000 && now - exported <= 30000
        ? ("fresh" as const)
        : ("stale" as const),
    received_age_seconds: Math.floor((now - received) / 1000),
    export_age_seconds: Math.floor((now - exported) / 1000),
  };
}
