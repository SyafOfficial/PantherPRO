export function publicOrigin(
  config: Record<string, string | undefined>,
  requestOrigin?: string | null,
) {
  const configured = config.APP_ORIGIN || config.RENDER_EXTERNAL_URL;
  if (configured) {
    const url = new URL(configured);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !["https:", "http:"].includes(url.protocol) ||
      (config.APP_MODE === "production" && url.protocol !== "https:")
    )
      throw new Error(
        "APP_ORIGIN must be a canonical HTTPS origin in production",
      );
    return url.origin;
  }
  if (config.APP_MODE === "production") throw new Error("APP_ORIGIN required");
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      if (
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["http:", "https:"].includes(url.protocol)
      )
        return url.origin;
    } catch {}
  }
  return "http://localhost:3000";
}
export function productionIssues(config: Record<string, string | undefined>) {
  if (config.APP_MODE !== "production") return [];
  const required = [
    "APP_ORIGIN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TRADINGVIEW_WEBHOOK_SECRET",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ];
  const errors = required
    .filter(
      (k) =>
        !(
          config[k] ||
          (k === "APP_ORIGIN" && config.RENDER_EXTERNAL_URL) ||
          (k === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" &&
            config.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        ),
    )
    .map((k) => `${k} is missing`);
  try {
    publicOrigin(config);
  } catch {
    errors.push("APP_ORIGIN is invalid");
  }
  try {
    const url = new URL(config.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password)
      errors.push("Supabase URL must use HTTPS");
  } catch {
    errors.push("Supabase URL is invalid");
  }
  if (
    config.TRADINGVIEW_WEBHOOK_SECRET &&
    (config.TRADINGVIEW_WEBHOOK_SECRET.length < 32 ||
      config.TRADINGVIEW_WEBHOOK_SECRET.length > 256)
  )
    errors.push("Webhook secret length is invalid");
  if (
    config.VAPID_SUBJECT &&
    !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(config.VAPID_SUBJECT)
  )
    errors.push("VAPID contact is invalid");
  return errors;
}
export function safeAuthNext(value: string | null) {
  return value === "/account/password" ? value : "/";
}
