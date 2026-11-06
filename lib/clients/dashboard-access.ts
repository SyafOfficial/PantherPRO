import type { SupabaseClient } from "@supabase/supabase-js";

/** The caller supplies a server-verified identity, never form or query data. */
export async function dashboardAccess(
  db: SupabaseClient,
  user: { id: string; role: string },
) {
  if (user.role === "admin") return true;
  const { data, error } = await db
    .from("client_applications")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error)
    throw new Error("Membership verification unavailable. Please retry.");
  if (data?.status !== "approved") return false;
  const access = await db.rpc("client_access_allowed");
  if (access.error)
    throw new Error("Access verification unavailable. Please retry.");
  return access.data === true;
}
