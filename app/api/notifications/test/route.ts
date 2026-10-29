import { authorizedRequest } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";
export async function POST(request: Request) {
  const auth = await authorizedRequest(request);
  if (auth.error) return auth.error;
  const db = await supabase();
  const { data, error } = await db.rpc("enqueue_test_notification");
  return error
    ? Response.json(
        { error: "Enable push first; tests are limited to one per minute" },
        { status: 429 },
      )
    : Response.json({ queued: true, eventId: data });
}
