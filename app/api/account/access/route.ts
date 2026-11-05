import { identity } from "@/lib/supabase";
import { clientAccessAllowed } from "@/lib/clients/access";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const user = await identity();
  if (!user) return Response.json({ allowed: false }, { status: 401, headers });
  return Response.json({ allowed: await clientAccessAllowed() }, { headers });
}
