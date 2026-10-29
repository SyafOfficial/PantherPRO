import { authorizedRequest } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";
import { boundedJson } from "@/lib/webhook";
import { preferenceSchema } from "@/lib/push";
export async function PUT(request: Request) {
  const auth = await authorizedRequest(request);
  if (auth.error) return auth.error;
  const parsed = preferenceSchema.safeParse(
    await boundedJson(request).catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: "Invalid preferences" }, { status: 400 });
  const db = await supabase();
  const { error } = await db.from("notification_preferences").upsert({
    ...parsed.data,
    user_id: auth.user.id,
    updated_at: new Date().toISOString(),
  });
  return error
    ? Response.json(
        { error: "Preferences could not be saved" },
        { status: 400 },
      )
    : Response.json({ saved: true });
}
