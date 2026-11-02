import { mt5SnapshotSchema } from "../lib/engine/mt5";
import { createClient } from "@supabase/supabase-js";
import {
  scanOwnerShadow,
  monitorOwnerShadow,
  type ShadowSetup,
  type ShadowProgress,
} from "../lib/engine/owner-shadow";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase service configuration required");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let stopping = false,
  lastExport = "";
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function cycle() {
  const { data, error } = await db
    .from("mt5_bridge_latest")
    .select("snapshot,received_at,exported_at")
    .eq("source", "vestrado")
    .single();
  if (error || !data || Date.now() - Date.parse(data.received_at) > 30000)
    throw new Error("Bridge unavailable or stale; scan withheld");
  if (lastExport === data.exported_at) return;
  const result = scanOwnerShadow(data.snapshot, Date.now());
  for (const setup of result.setups) {
    const { error: saveError } = await db.rpc("record_owner_shadow", {
      proposal: setup,
    });
    if (saveError) throw new Error("Private shadow migration required");
  }
  const snapshot = mt5SnapshotSchema.parse(data.snapshot);
  const { data: active, error: activeError } = await db
    .from("owner_shadow_setups")
    .select("id,payload,progress,version")
    .eq("payload->>status", "entry_confirmed")
    .eq("progress->>invalidated", "false")
    .order("created_at")
    .limit(200);
  if (activeError) throw new Error("Private shadow state unavailable");
  for (const row of active ?? []) {
    const setup = row.payload as ShadowSetup;
    const candles =
      setup.direction === "BUY"
        ? snapshot.series.find((x) => x.timeframe === "M5")!.candles
        : (snapshot.ask_m5 ?? []);
    const candle = candles.at(-1);
    const progress = row.progress as ShadowProgress;
    // Snapshot quotes are observed now, not replayed as historical broker fills.
    const output = monitorOwnerShadow(setup, progress, {
      at: snapshot.server_time_raw,
      bid: snapshot.quote.bid,
      ask: snapshot.quote.ask,
      ...(candle && candle.opened_at_server_raw + 300 > progress.lastClose
        ? {
            m5: {
              closedAt: candle.opened_at_server_raw + 300,
              close: candle.close,
            },
          }
        : {}),
    });
    const { error: commitError } = await db.rpc(
      "commit_owner_shadow_progress",
      {
        setup_key: row.id,
        expected_version: row.version,
        next_progress: output.state,
        emitted: output.events,
      },
    );
    if (commitError) throw new Error("Private shadow progress not committed");
  }
  console.info(JSON.stringify({ event: "owner_shadow_scan", ...result }));
  lastExport = data.exported_at;
}
async function main() {
  do {
    try {
      await cycle();
    } catch {
      console.error(
        JSON.stringify({
          event: "owner_shadow_unavailable",
          message:
            "Check bridge, Daily history and database access. No client signal sent.",
        }),
      );
    }
    if (process.argv.includes("--once")) break;
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 10000));
  } while (!stopping);
}
void main();
