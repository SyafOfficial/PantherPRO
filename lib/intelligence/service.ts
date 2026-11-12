import "server-only";
import { supabase, identity } from "../supabase";
import { serviceConfigured, serviceDb } from "../service-db";
import { frameIndex } from "../engine/display";
import {
  buildIntelligence,
  mt5TechnicalAnalysis,
  technicalFrames,
} from "./engine";
import type { IntelligenceInputs } from "./types";

export async function loadIntelligence() {
  const empty = { quotes: [], events: [], as_of: new Date().toISOString() };
  if (!(await identity())) return buildIntelligence(empty);
  const db = await supabase();
  const projection = [
    "received_at,exported_at,source:snapshot->provider,symbol:snapshot->symbol,quote:snapshot->quote,server_time_raw:snapshot->server_time_raw",
    ...technicalFrames.map(
      (frame) => `${frame}:snapshot->series->${frameIndex[frame]}`,
    ),
  ].join(",");
  // The dashboard and API check member access before calling this loader.
  // Vestrado is approved for this derived report. Return no raw bridge fields.
  const [licensed, bridge] = await Promise.all([
    db.rpc("get_intelligence_inputs"),
    serviceConfigured()
      ? serviceDb()
          .from("mt5_bridge_latest")
          .select(projection)
          .eq("source", "vestrado")
          .maybeSingle()
      : null,
  ]);
  const now = Date.now();
  let mt5Report;
  if (bridge?.data) {
    try {
      mt5Report = mt5TechnicalAnalysis(
        bridge.data as unknown as Record<string, unknown>,
        now,
      );
    } catch {
      console.warn(
        "MT5 technical report unavailable due to invalid bridge fields.",
      );
    }
  }
  const inputs = licensed.data as IntelligenceInputs | null;
  const bundle = buildIntelligence(inputs ?? empty, now, mt5Report);
  return { ...bundle, error: Boolean(licensed.error && !mt5Report) };
}
