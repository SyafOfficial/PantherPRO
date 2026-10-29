import "server-only";
export function integrationStatus() {
  return {
    market: "disconnected",
    calendar: "disconnected",
    ai: "disconnected",
    webhook:
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      (process.env.TRADINGVIEW_WEBHOOK_SECRET?.length ?? 0) >= 32
        ? "configured_unverified"
        : "disconnected",
    push:
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
        ? "configured_unverified"
        : "disconnected",
  };
}
