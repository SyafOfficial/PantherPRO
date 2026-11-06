import type { SupabaseClient } from "@supabase/supabase-js";
type CycleResult = {
  available: boolean;
  reason?: string;
  published?: number;
  events?: number;
  tickVolumePublished?: number;
  tickVolumeState?: string;
};
/** Reuse the database cursor in-process: inspect a lightweight export stamp before
 * loading/parsing the full snapshot again. Failed work remains retryable. */
export function createEngineRunner(
  db: SupabaseClient,
  run: () => Promise<CycleResult>,
) {
  let completed: string | null = null;
  let running: Promise<CycleResult> | null = null;
  return function cycle(): Promise<CycleResult> {
    if (running) return running;
    running = (async () => {
      const { data, error } = await db
        .from("mt5_bridge_latest")
        .select("exported_at")
        .eq("source", "vestrado")
        .maybeSingle();
      if (error) throw new Error("Engine cursor unavailable");
      if (!data)
        return { available: true, reason: "feed_unavailable_or_stale" };
      if (data.exported_at === completed)
        return { available: true, reason: "already_processed" };
      const result = await run();
      if (
        result.available &&
        result.tickVolumeState !== "publication_unavailable" &&
        !["feed_unavailable_or_stale", "snapshot_not_eligible"].includes(
          result.reason ?? "",
        )
      )
        completed = data.exported_at;
      return result;
    })().finally(() => {
      running = null;
    });
    return running;
  };
}
