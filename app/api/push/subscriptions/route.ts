import { authorizedRequest } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";
import { boundedJson } from "@/lib/webhook";
import { subscriptionSchema } from "@/lib/push";
export async function POST(request: Request) {
  const auth = await authorizedRequest(request);
  if (auth.error) return auth.error;
  const parsed = subscriptionSchema.safeParse(
    await boundedJson(request).catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid or unsupported push subscription" },
      { status: 400 },
    );
  const db = await supabase();
  const { error } = await db.rpc("register_push_subscription", {
    subscription: parsed.data,
  });
  return error
    ? Response.json(
        { error: "Subscription could not be saved" },
        { status: 400 },
      )
    : Response.json({ saved: true });
}
export async function DELETE(request: Request) {
  const auth = await authorizedRequest(request);
  if (auth.error) return auth.error;
  const body = (await boundedJson(request).catch(() => null)) as {
    endpoint?: unknown;
  } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 2048)
    return Response.json({ error: "Endpoint required" }, { status: 400 });
  const db = await supabase();
  const { error } = await db.rpc("remove_push_subscription", {
    subscription_endpoint: body.endpoint,
  });
  return error
    ? Response.json(
        { error: "Subscription could not be removed" },
        { status: 400 },
      )
    : Response.json({ removed: true });
}
