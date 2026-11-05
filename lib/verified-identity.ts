import type { SupabaseClient } from "@supabase/supabase-js";
/** Only verified claims establish identity; editable metadata never grants a role. */
export async function verifiedIdentity(db: SupabaseClient) {
  const { data, error } = await db.auth.getClaims();
  if (error) {
    if (!error.status || error.status >= 500)
      throw new Error("Session verification is temporarily unavailable.");
    return null;
  }
  const claims = data?.claims;
  if (!claims?.sub || typeof claims.sub !== "string") return null;
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("role,display_name")
    .eq("id", claims.sub)
    .single();
  if (profileError && profileError.code !== "PGRST116")
    throw new Error("Your account could not be loaded. Please retry.");
  if (!profile) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    role: profile.role as string,
    name: (profile.display_name || "Member") as string,
  };
}
