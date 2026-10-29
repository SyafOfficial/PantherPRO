import "server-only";
import { identity } from "./supabase";
import { sameOriginMutation } from "./request-security";
export async function authorizedRequest(request: Request) {
  // These are browser mutations, not third-party ingestion: require same-origin fetches.
  if (!sameOriginMutation(request))
    return {
      error: Response.json(
        { error: "Cross-origin mutation denied" },
        { status: 403 },
      ),
    };
  const user = await identity();
  if (!user)
    return {
      error: Response.json({ error: "Sign in required" }, { status: 401 }),
    };
  return { user };
}
