import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
export type RelayConfig = {
  url: string;
  gatewayToken: string;
  signingKey: string;
};
export type RelayItem = {
  outbox_id: string;
  payload: unknown;
  lease_token: string;
};
export function relayConfig(
  env: Record<string, string | undefined>,
): RelayConfig | null {
  if (
    !env.TELEGRAM_SIGNAL_RELAY_URL ||
    !env.TELEGRAM_SIGNAL_GATEWAY_TOKEN ||
    !env.TELEGRAM_SIGNAL_SIGNING_KEY
  )
    return null;
  const url = new URL(env.TELEGRAM_SIGNAL_RELAY_URL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/api/relay/telegram"
  )
    throw new Error("Invalid relay endpoint");
  return {
    url: url.href,
    gatewayToken: env.TELEGRAM_SIGNAL_GATEWAY_TOKEN,
    signingKey: env.TELEGRAM_SIGNAL_SIGNING_KEY,
  };
}
export function signedRelayRequest(
  config: RelayConfig,
  payload: unknown,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const body = JSON.stringify(payload),
    stamp = String(timestamp);
  return {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "OAI-Sites-Authorization": `Bearer ${config.gatewayToken}`,
      "x-panther-timestamp": stamp,
      "x-panther-signature": createHmac("sha256", config.signingKey)
        .update(`${stamp}.${body}`)
        .digest("hex"),
    },
    body,
    signal: AbortSignal.timeout(25000),
  } satisfies RequestInit;
}
export async function forwardRelayItem(
  db: SupabaseClient,
  item: RelayItem,
  config: RelayConfig,
  send: typeof fetch = fetch,
) {
  let state: "delivered" | "retry" | "review" | "failed" | "skipped" = "retry",
    reason = "relay_unavailable",
    messageId: number | null = null;
  try {
    const response = await send(
      config.url,
      signedRelayRequest(config, item.payload),
    );
    const result = await response.json();
    if (
      response.ok &&
      ["delivered", "review", "failed", "skipped"].includes(result.state)
    ) {
      state = result.state;
      reason = typeof result.reason === "string" ? result.reason : "";
      if (Number.isSafeInteger(result.messageId)) messageId = result.messageId;
    } else if ([400, 409].includes(response.status)) {
      state = "failed";
      reason = "relay_event_invalid";
    }
  } catch {
    /* Retry the same event identity; the destination owns send deduplication. */
  }
  const { error } = await db.rpc("finish_telegram_signal_event", {
    event_id: item.outbox_id,
    claim_token: item.lease_token,
    result_state: state,
    message_id: messageId,
    failure_code: reason || null,
  });
  if (error) throw new Error("Telegram lease completion failed");
  console.info(
    JSON.stringify({
      component: "telegram_signal_relay",
      eventId: item.outbox_id,
      state,
    }),
  );
}
export async function probeTelegramRelay(
  config: RelayConfig,
  send: typeof fetch = fetch,
) {
  const response = await send(
    config.url,
    signedRelayRequest(config, { version: "panther.signal.v1", type: "probe" }),
  );
  const result = await response.json();
  if (!response.ok || result.ready !== true)
    throw new Error("Telegram relay readiness probe failed");
  return { ready: true, enabled: result.enabled === true };
}
export function createTelegramRelayCycle(
  db: SupabaseClient,
  env: Record<string, string | undefined> = process.env,
) {
  let config: RelayConfig | null;
  try {
    config = relayConfig(env);
  } catch {
    console.warn(
      JSON.stringify({
        component: "telegram_signal_relay",
        state: "configuration_invalid",
      }),
    );
    config = null;
  }
  let probed = false;
  return async () => {
    if (!config) return 0;
    if (!probed) {
      const result = await probeTelegramRelay(config);
      probed = true;
      console.info(
        JSON.stringify({
          component: "telegram_signal_relay",
          state: "ready",
          enabled: result.enabled,
        }),
      );
    }
    const prepared = await db.rpc("prepare_telegram_signal_events");
    if (prepared.error) throw new Error("Telegram queue preparation failed");
    const { data, error } = await db.rpc("claim_telegram_signal_events", {
      batch_size: 5,
    });
    if (error) throw new Error("Telegram queue claim failed");
    for (const item of (data ?? []) as RelayItem[])
      await forwardRelayItem(db, item, config);
    return data?.length ?? 0;
  };
}
