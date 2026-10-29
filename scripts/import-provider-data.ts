import { readFile, stat } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { quoteSchema, calendarEventSchema } from "../lib/market-data";
// A normalized licensed-provider boundary, not a guessed vendor API adapter.
const [kind, path] = process.argv.slice(2);
if (!["quote", "calendar"].includes(kind) || !path)
  throw new Error(
    "Usage: npm run data:import -- quote|calendar path-to-normalized-json",
  );
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
)
  throw new Error("Supabase service configuration required; no data imported");
if ((await stat(path)).size > 1024 * 1024)
  throw new Error("Provider import exceeds 1 MiB");
const raw = await readFile(path);
if (raw.length > 1024 * 1024) throw new Error("Provider import exceeds 1 MiB");
let records: Array<
  | ReturnType<typeof quoteSchema.parse>
  | ReturnType<typeof calendarEventSchema.parse>
>;
try {
  const input: unknown = JSON.parse(raw.toString("utf8"));
  const rows = Array.isArray(input) ? input : [input];
  if (!rows.length || rows.length > 500) throw new Error("Invalid batch size");
  records = rows.map((row) =>
    kind === "quote" ? quoteSchema.parse(row) : calendarEventSchema.parse(row),
  );
} catch {
  throw new Error(
    "Invalid normalized provider batch. Expected 1–500 schema-valid records; no rows imported. Source contents are not logged.",
  );
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let imported = 0;
for (const record of records) {
  const { error } = await db.rpc(
    kind === "quote" ? "ingest_market_quote" : "ingest_calendar_event",
    { observation: record },
  );
  if (error)
    throw new Error(
      `Provider import rejected at record ${imported + 1}; check registered provider permissions, timestamps and duplicate references. Earlier records, if any, remain imported.`,
    );
  imported++;
}
if (kind === "calendar") {
  const { error } = await db.rpc("queue_upcoming_calendar_events");
  if (error)
    throw new Error(
      "Events imported but upcoming-event queue could not be refreshed",
    );
}
console.info(
  JSON.stringify({
    kind,
    records: imported,
    status: "stored",
    note: "Storage acknowledgment is not external provider verification",
  }),
);
