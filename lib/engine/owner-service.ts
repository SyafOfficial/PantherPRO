import type { SupabaseClient } from "@supabase/supabase-js";
import { mt5SnapshotSchema } from "./mt5";
import {
  scanOwnerShadow,
  monitorOwnerShadow,
  type ShadowSetup,
  type ShadowProgress,
} from "./owner-shadow";
export function createOwnerShadowCycle(db: SupabaseClient) {
  let lastExport = "";
  return async function cycle() {
    const { data, error } = await db
      .from("mt5_bridge_latest")
      .select("snapshot,received_at,exported_at")
      .eq("source", "vestrado")
      .single();
    if (error || !data || Date.now() - Date.parse(data.received_at) > 30000)
      throw new Error("Bridge unavailable or stale; scan withheld");
    if (lastExport === data.exported_at) return { state: "unchanged" };
    const result = scanOwnerShadow(data.snapshot, Date.now());
    const storage = await db
      .from("owner_shadow_setups")
      .select("id", { head: true, count: "exact" });
    if (storage.error) {
      lastExport = data.exported_at;
      return {
        state: "migration_required",
        setups: result.setups.length,
        reasons: result.reasons,
      };
    }
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

    lastExport = data.exported_at;
    return {
      state: "observed",
      setups: result.setups.length,
      reasons: result.reasons,
    };
  };
}
