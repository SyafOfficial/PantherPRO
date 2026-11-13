import { scanTickVolume } from "./tick-volume";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutomaticPlan } from "./automatic";
import { scanLiveAutomatic } from "./trendline-live";
import { ROLE_REVERSAL_VERSION } from "./role-reversal";
export async function automaticEngineCycle(db: SupabaseClient) {
  const { data: policy, error: policyError } = await db
    .from("automatic_engine_policy")
    // Additive capability marker is absent before the SBR/RBS migration.
    // Reading the row keeps old schemas usable without a failing column query.
    .select("*")
    .eq("singleton", true)
    .single();
  // Existing deployments remain usable before migration 011 is applied.
  if (policyError) {
    if (["42P01", "PGRST205"].includes(policyError.code))
      return { available: false };
    throw new Error("Engine policy unavailable");
  }
  const { data: feed, error } = await db
    .from("mt5_bridge_latest")
    .select("snapshot,exported_at,received_at")
    .eq("source", "vestrado")
    .single();
  if (error || !feed || Date.now() - Date.parse(feed.received_at) > 30000)
    return { available: true, reason: "feed_unavailable_or_stale" };
  let plans: AutomaticPlan[] = [];
  try {
    if (policy.enabled) {
      const scan = scanLiveAutomatic(feed.snapshot, Date.now(), {
        roleReversals:
          policy.role_reversal_schema_version === ROLE_REVERSAL_VERSION,
      });
      plans = scan.plans;
      // Bounded market-only rejection diagnostics persist in worker logs; never log snapshots/accounts.
      const reasons = scan.reasons.filter((r) => /^(SBR|RBS)/.test(r));
      if (reasons.length)
        console.info(
          JSON.stringify({
            event: "engine.sbr_rbs_rejected",
            exportTime: feed.exported_at,
            reasons,
          }),
        );
    }
  } catch {
    return { available: true, reason: "snapshot_not_eligible" };
  }
  const { data, error: applyError } = await db.rpc("apply_automatic_engine", {
    export_time: feed.exported_at,
    plans,
  });
  if (applyError)
    throw new Error(
      "Automatic engine transaction rejected; no partial publication",
    );
  // Structural monitoring always runs first; an independent tick failure must not roll it back.
  let tickVolumePublished = 0;
  let tickVolumeState = "paused";
  if (policy.enabled) {
    try {
      const proposal = scanTickVolume(feed.snapshot, Date.now());
      const { data: tick, error: tickError } = await db.rpc(
        "apply_tick_volume",
        {
          export_time: feed.exported_at,
          proposal,
        },
      );
      if (tickError) tickVolumeState = "publication_unavailable";
      else {
        tickVolumePublished = tick?.published ?? 0;
        tickVolumeState = tick?.reason ?? "processed";
      }
    } catch {
      tickVolumeState = "snapshot_not_eligible";
    }
  }
  return {
    available: true,
    ...data,
    published: (data?.published ?? 0) + tickVolumePublished,
    tickVolumePublished,
    tickVolumeState,
  };
}
