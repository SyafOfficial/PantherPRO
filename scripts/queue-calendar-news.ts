import { createClient } from "@supabase/supabase-js";
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
)
  throw new Error("Supabase service configuration required; no news queued");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data, error } = await db.rpc("queue_upcoming_calendar_events");
if (error)
  throw new Error(
    "Upcoming-event queue refresh failed; check migrations and database connectivity",
  );
console.info(
  JSON.stringify({ queued: data, note: "Queued does not mean delivered" }),
);
