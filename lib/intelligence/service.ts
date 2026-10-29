import "server-only";
import { supabase, identity } from "../supabase";
import { buildIntelligence } from "./engine";
import type { IntelligenceInputs } from "./types";
export async function loadIntelligence() {
  const now = new Date().toISOString();
  const empty = { quotes: [], events: [], as_of: now };
  if (!(await identity())) return buildIntelligence(empty);
  const db = await supabase();
  const { data, error } = await db.rpc("get_intelligence_inputs");
  if (error) return { ...buildIntelligence(empty), error: true };
  return buildIntelligence(data as IntelligenceInputs);
}
