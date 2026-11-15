import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  probeTelegramRelay,
  relayConfig,
  signedRelayRequest,
  forwardRelayItem,
  createTelegramRelayCycle,
} from "../lib/telegram-relay";
const config = {
  url: "https://panel.test/api/relay/telegram",
  gatewayToken: "test-gateway",
  signingKey: "test-signing-key",
};
test("relay requests sign exact payload, reject redirects and remain disabled without configuration", () => {
  const payload = { version: "panther.signal.v1", eventId: "event" },
    r = signedRelayRequest(config, payload, 1800000000);
  assert.equal(r.redirect, "error");
  assert.equal(
    r.headers["x-panther-signature"],
    createHmac("sha256", config.signingKey)
      .update("1800000000." + r.body)
      .digest("hex"),
  );
  assert.equal(relayConfig({}), null);
  assert.throws(() =>
    relayConfig({
      TELEGRAM_SIGNAL_RELAY_URL: "http://panel.test/api/relay/telegram",
      TELEGRAM_SIGNAL_GATEWAY_TOKEN: "x",
      TELEGRAM_SIGNAL_SIGNING_KEY: "x",
    }),
  );
});
test("delivery completion uses leases; network uncertainty retries same identity, explicit review never resends automatically", async () => {
  for (const outcome of ["delivered", "review", "skipped", "network"]) {
    let args: Record<string, unknown> | undefined;
    const db = {
      rpc: async (name: string, p: Record<string, unknown>) => {
        assert.equal(name, "finish_telegram_signal_event");
        args = p;
        return { error: null };
      },
    } as unknown as SupabaseClient;
    const send = (async () => {
      if (outcome === "network") throw new Error("Timeout");
      return Response.json({
        state: outcome,
        messageId: outcome === "delivered" ? 123 : undefined,
      });
    }) as typeof fetch;
    await forwardRelayItem(
      db,
      { outbox_id: "event", lease_token: "lease", payload: { id: "stable" } },
      config,
      send,
    );
    assert.equal(args?.result_state, outcome === "network" ? "retry" : outcome);
    assert.equal(args?.claim_token, "lease");
    assert.equal(args?.event_id, "event");
  }
});
test("missing relay settings makes no database or network calls", async () => {
  const db = {
    rpc: () => {
      throw new Error("Unexpected RPC");
    },
  } as unknown as SupabaseClient;
  assert.equal(await createTelegramRelayCycle(db, {})(), 0);
  assert.equal(
    await createTelegramRelayCycle(db, {
      TELEGRAM_SIGNAL_RELAY_URL: "invalid",
      TELEGRAM_SIGNAL_GATEWAY_TOKEN: "x",
      TELEGRAM_SIGNAL_SIGNING_KEY: "x",
    })(),
    0,
  );
});

test("readiness probe never submits a trading event", async () => {
  const send = (async (_url: unknown, init: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init.body)), {
      version: "panther.signal.v1",
      type: "probe",
    });
    return Response.json({ ready: true, enabled: true });
  }) as typeof fetch;
  assert.deepEqual(await probeTelegramRelay(config, send), {
    ready: true,
    enabled: true,
  });
});
