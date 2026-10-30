import { createClient } from "@supabase/supabase-js";
import { scanMt5Structure } from "../lib/engine/structure";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service configuration required");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .from("mt5_bridge_latest")
    .select("snapshot,received_at")
    .eq("source", "vestrado")
    .single();
  if (error || !data) throw new Error("No accessible MT5 snapshot");
  if (Date.now() - Date.parse(data.received_at) > 30000)
    throw new Error("Last bridge receipt is stale; no scan produced");
  console.info(
    JSON.stringify(scanMt5Structure(data.snapshot, Date.now()), null, 2),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Shadow scan failed");
  process.exitCode = 1;
});
