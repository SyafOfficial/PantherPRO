export function feedStatus(
  row: { received_at: string; exported_at: string } | null,
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
  return {
    status:
      now - received <= 30000 && now - exported <= 30000
        ? ("fresh" as const)
        : ("stale" as const),
    received_age_seconds: Math.floor((now - received) / 1000),
    export_age_seconds: Math.floor((now - exported) / 1000),
  };
}
