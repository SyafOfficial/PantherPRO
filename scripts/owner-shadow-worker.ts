import { createClient } from "@supabase/supabase-js";
import { createOwnerShadowCycle } from "../lib/engine/owner-service";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase service configuration required");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let stopping = false;
const cycle = createOwnerShadowCycle(db);
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  do {
    try {
      console.info(JSON.stringify(await cycle()));
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
