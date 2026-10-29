import { z } from "zod";
export const preferenceSchema = z
  .object({
    signals: z.boolean(),
    targets: z.boolean(),
    news: z.boolean(),
    announcements: z.boolean(),
    push_enabled: z.boolean(),
  })
  .strict();
export function safePushEndpoint(value: string) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.hash ||
      value.length > 2048
    )
      return false;
    return (
      [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(u.hostname) ||
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}
export const subscriptionSchema = z
  .object({
    endpoint: z.string().refine(safePushEndpoint, "Unsupported push service"),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
      })
      .strict(),
  })
  .strict();
export function notificationPayload(delivery: {
  id: string;
  outbox_id: string;
  event_type: string;
  signal_id: string | null;
  calendar_event_id?: string | null;
}) {
  return {
    id: delivery.id,
    eventId: delivery.outbox_id,
    eventType: delivery.event_type,
    title: "Panther FX intelligence",
    body: "A new update is available. Open your terminal to review it.",
    url: delivery.signal_id
      ? `/?view=Signals&signal=${encodeURIComponent(delivery.signal_id)}`
      : delivery.event_type.startsWith("news.")
        ? `/?view=Economic%20Calendar${delivery.calendar_event_id ? `&event=${encodeURIComponent(delivery.calendar_event_id)}` : ""}`
        : "/account#announcements",
    tag: `panther-${delivery.id}`,
  };
}
export function retryDelay(attempt: number) {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
}
