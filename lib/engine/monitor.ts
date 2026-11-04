import type { SupabaseClient } from "@supabase/supabase-js";
export async function monitorAcceptedSnapshot(
  db: SupabaseClient,
  exportedAt: string,
) {
  try {
    const { data, error } = await db.rpc("apply_automatic_engine", {
      export_time: exportedAt,
      plans: [],
    });
    if (error) throw new Error("monitor rejected");
    if (data?.events)
      console.info(
        JSON.stringify({
          component: "bridge_monitor",
          events: data.events,
          observedAt: exportedAt,
          detectionLagMs: Date.now() - Date.parse(exportedAt),
        }),
      );
  } catch {
    // The independent worker retries fresh snapshots; acceptance stays truthful.
    console.warn("Bridge monitoring unavailable; worker fallback retained.");
  }
}
