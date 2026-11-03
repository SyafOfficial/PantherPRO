import { createCalendarDisplayRefresh } from "../lib/calendar-display-cache";
import { ownerShadowFailure } from "../lib/engine/owner-service";
import { createOwnerShadowCycle } from "../lib/engine/owner-service";
import { automaticEngineCycle } from "../lib/engine/service";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  safePushEndpoint,
  notificationPayload,
  type PushSignalDetails,
} from "../lib/push";
import { classifyPushFailure } from "../lib/delivery";
import { createCalendarSync } from "../lib/calendar-sync";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;
for (const key of required)
  if (!process.env[key])
    throw new Error(`Missing ${key}; push worker was not started`);
const subject = process.env.VAPID_SUBJECT!;
if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject))
  throw new Error("VAPID_SUBJECT must identify a real HTTPS or mailto contact");
webpush.setVapidDetails(
  subject,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
type Delivery = {
  id: string;
  outbox_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lease_token: string;
  attempts: number;
  event_type: string;
  signal_id: string | null;
  calendar_event_id?: string | null;
};
const syncCalendar = createCalendarSync(db, {
  url: process.env.FF_SCRAPER_API_URL,
  token: process.env.FF_SCRAPER_AUTH_TOKEN,
  providerId: process.env.FF_CALENDAR_PROVIDER_ID,
});
async function rpc(name: string, params?: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, params);
  if (error) throw new Error(`Worker database operation failed: ${name}`);
  return data;
}
async function finish(item: Delivery, state: string, code?: string) {
  const saved = await rpc("finish_push_delivery", {
    delivery_id: item.id,
    claim_token: item.lease_token,
    result_state: state,
    failure_code: code ?? null,
  });
  if (!saved)
    console.warn(JSON.stringify({ deliveryId: item.id, state: "lease_lost" }));
}
const refreshCalendarDisplay = createCalendarDisplayRefresh(db, {
  url: process.env.FF_SCRAPER_API_URL,
  token: process.env.FF_SCRAPER_AUTH_TOKEN,
});
const ownerShadowCycle = createOwnerShadowCycle(db);
let ownerCheckedAt = 0;
async function cycle() {
  // Do not make engine/push processing wait on external calendar requests.
  void refreshCalendarDisplay().catch(() =>
    console.warn(
      "Calendar display refresh unavailable; cached schedule retained.",
    ),
  );
  if (Date.now() - ownerCheckedAt >= 60000) {
    ownerCheckedAt = Date.now();
    try {
      console.info(
        JSON.stringify({
          component: "owner_shadow",
          ...(await ownerShadowCycle()),
        }),
      );
    } catch (error) {
      console.warn(
        JSON.stringify({
          component: "owner_shadow",
          ...ownerShadowFailure(error),
        }),
      );
    }
  }
  try {
    const calendar = await syncCalendar();
    if (calendar.imported)
      console.info(
        JSON.stringify({
          component: "calendar_sync",
          imported: calendar.imported,
        }),
      );
  } catch {
    console.error(
      "Calendar sync unavailable; existing push delivery continues.",
    );
  }
  try {
    const engine = await automaticEngineCycle(db);
    if (
      engine.published ||
      engine.events ||
      engine.tickVolumeState === "publication_unavailable"
    )
      console.info(
        JSON.stringify({
          component: "automatic_engine",
          published: engine.published ?? 0,
          tickVolumePublished: engine.tickVolumePublished ?? 0,
          tickVolumeState: engine.tickVolumeState,
          events: engine.events ?? 0,
        }),
      );
  } catch {
    // A scanner failure must not stop already queued push deliveries.
    console.error(
      "Automatic engine cycle rejected; existing push delivery continues.",
    );
  }
  await rpc("prepare_push_deliveries", { batch_size: 20 });
  // Small batches keep serial network calls below the two-minute lease.
  const deliveries = (await rpc("claim_push_deliveries", {
    batch_size: 5,
  })) as Delivery[];
  for (const item of deliveries) {
    if (!safePushEndpoint(item.endpoint)) {
      await finish(item, "failed", "unsupported_endpoint");
      continue;
    }
    if (
      !(await rpc("notification_allowed", {
        event_id: item.outbox_id,
        device_id: item.subscription_id,
      }))
    ) {
      await finish(item, "skipped", "no_longer_eligible");
      continue;
    }
    try {
      let signal: PushSignalDetails | null = null;
      if (item.event_type === "signal.active" && item.signal_id) {
        const { data, error } = await db
          .from("signals")
          .select(
            "direction,entry,entry_low,entry_high,stop_loss,tp1,tp2,tp3,status,published_at",
          )
          .eq("id", item.signal_id)
          .maybeSingle();
        if (error) throw new Error("Entry notification lookup failed");
        if (!data || data.status !== "active" || !data.published_at) {
          await finish(item, "skipped", "signal_not_active");
          continue;
        }
        signal = data;
        if (
          !(await rpc("notification_allowed", {
            event_id: item.outbox_id,
            device_id: item.subscription_id,
          }))
        ) {
          await finish(item, "skipped", "no_longer_eligible");
          continue;
        }
      }
      await webpush.sendNotification(
        {
          endpoint: item.endpoint,
          keys: { p256dh: item.p256dh, auth: item.auth },
        },
        JSON.stringify(notificationPayload(item, signal)),
        { TTL: 300, urgency: "normal", timeout: 10000 },
      );
      await finish(item, "delivered");
      // A push-service acceptance is not proof that a physical device displayed it.
      console.info(
        JSON.stringify({ deliveryId: item.id, state: "push_service_accepted" }),
      );
    } catch (error) {
      const failure = classifyPushFailure(error);
      await finish(item, failure.state, failure.code);
    }
  }
  await rpc("finalize_push_events");
  return deliveries.length;
}
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  do {
    try {
      const count = await cycle();
      if (process.argv.includes("--once")) break;
      if (!count) await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch {
      console.error(
        "Push worker cycle failed; inspect database connectivity and migration status. No credentials or endpoints logged.",
      );
      if (process.argv.includes("--once")) {
        process.exitCode = 1;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  } while (!stopping);
}
void main();
