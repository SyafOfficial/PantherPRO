import type { SupabaseClient } from "@supabase/supabase-js";
export type ClientPushDetails = { full_name: string; mt5_login: string };
/** Resolve only the client named by a trusted, recipient-specific outbox event. */
export async function clientPushDetails(
  db: SupabaseClient,
  eventId: string,
  eventType: string,
) {
  if (!["client.approved", "client.revoked"].includes(eventType)) return null;
  const { data: event, error } = await db
    .from("notification_outbox")
    .select("event_key,recipient_id,event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error("Client notification event lookup failed");
  if (!event || event.event_type !== eventType)
    throw new Error("Client notification event unavailable");
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const match = new RegExp(
    `^(${uuid}):client:(approved|revoked):${uuid}:(${uuid})$`,
    "i",
  ).exec(event.event_key);
  if (
    !match ||
    `client.${match[2]}` !== eventType ||
    match[3] !== event.recipient_id
  )
    throw new Error("Client notification event mismatch");
  const { data: client, error: clientError } = await db
    .from("client_applications")
    .select("full_name,mt5_login")
    .eq("user_id", match[1])
    .maybeSingle();
  if (clientError) throw new Error("Client notification lookup failed");
  return client as ClientPushDetails | null;
}
