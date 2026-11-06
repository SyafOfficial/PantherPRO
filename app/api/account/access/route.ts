import { identity, supabase } from "@/lib/supabase";
import { dashboardAccess } from "@/lib/clients/dashboard-access";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const user = await identity();
  if (!user) return Response.json({ allowed: false }, { status: 401, headers });
  return Response.json(
    { allowed: await dashboardAccess(await supabase(), user) },
    { headers },
  );
}
