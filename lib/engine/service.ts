import type { SupabaseClient } from "@supabase/supabase-js";
import { scanAutomatic, type AutomaticPlan } from "./automatic";
export async function automaticEngineCycle(db: SupabaseClient) {
  const { data: policy, error: policyError } = await db
    .from("automatic_engine_policy")
    .select("enabled,version")
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
    if (policy.enabled) plans = scanAutomatic(feed.snapshot, Date.now()).plans;
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
  return { available: true, ...data };
}
