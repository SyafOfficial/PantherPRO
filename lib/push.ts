import type { ClientPushDetails } from "./client-push";
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
export type PushSignalDetails = {
  status?: string;
  break_even?: boolean;
  direction: string;
  entry: number | string;
  entry_low: number | string | null;
  entry_high: number | string | null;
  stop_loss: number | string;
  tp1: number | string;
  tp2: number | string;
  tp3: number | string;
};
export function notificationPayload(
  delivery: {
    id: string;
    outbox_id: string;
    event_type: string;
    signal_id: string | null;
    calendar_event_id?: string | null;
  },
  signal?: PushSignalDetails | null,
  client?: ClientPushDetails | null,
) {
  let title = "Panther FX intelligence";
  let body = "A new update is available. Open your terminal to review it.";
  if (delivery.event_type === "signal.be_hit") {
    title = "Our setup HIT BE!";
    body = "Ready next zone";
  }
  if (delivery.event_type === "signal.break_even") {
    title = "50 pips running!";
    body = "Close partial now";
  }
  if (delivery.event_type === "signal.stop_hit" && signal?.break_even) {
    title = "Original SL reached";
    body = "50-pip BE alert was issued earlier. Check your managed position.";
  }
  if (delivery.event_type === "signal.active" && signal) {
    const values = [
      signal.entry,
      signal.stop_loss,
      signal.tp1,
      signal.tp2,
      signal.tp3,
    ].map(Number);
    const low = signal.entry_low == null ? values[0] : Number(signal.entry_low);
    const high =
      signal.entry_high == null ? values[0] : Number(signal.entry_high);
    if (
      ![...values, low, high].every((n) => Number.isFinite(n) && n > 0) ||
      low > high ||
      !["BUY", "SELL"].includes(signal.direction)
    )
      throw new Error("Invalid entry notification levels");
    const price = (n: number) => n.toFixed(2);
    title = `Panther FX · XAUUSD ${signal.direction}`;
    body = [
      `Entry: ${price(low)} – ${price(high)}`,
      `SL: ${price(values[1])}`,
      `TP1: ${price(values[2])}`,
      `TP2: ${price(values[3])}`,
      `TP3: ${price(values[4])}`,
    ].join("\n");
    if (signal.status && signal.status !== "active") {
      title += " · Closed";
      body = "Setup closed. Do not enter.\n" + body;
    }
  }
  if (delivery.event_type === "client.approved") {
    title = "Client approved";
    body = "A client was approved. Open your client directory.";
  }
  if (delivery.event_type === "client.revoked") {
    title = "Client access revoked";
    body =
      "A client no longer meets the access requirements. Open your client directory to review.";
  }
  if (
    client &&
    ["client.approved", "client.revoked"].includes(delivery.event_type)
  ) {
    const name = client.full_name
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    if (name && /^[1-9][0-9]{3,19}$/.test(client.mt5_login))
      body = `${name} · MT5 ${client.mt5_login}\n${delivery.event_type === "client.approved" ? "Membership approved." : "Membership access revoked."}`;
  }
  return {
    id: delivery.id,
    eventId: delivery.outbox_id,
    eventType: delivery.event_type,
    title,
    body,
    url: delivery.event_type.startsWith("client.")
      ? "/admin/clients"
      : delivery.signal_id
        ? `/dashboard?view=Signals&signal=${encodeURIComponent(delivery.signal_id)}`
        : delivery.event_type.startsWith("news.")
          ? `/dashboard?view=Economic%20Calendar${delivery.calendar_event_id ? `&event=${encodeURIComponent(delivery.calendar_event_id)}` : ""}`
          : "/account#announcements",
    tag: `panther-${delivery.id}`,
  };
}
export function retryDelay(attempt: number) {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
}
