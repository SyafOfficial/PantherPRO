import { identity } from "@/lib/supabase";
import { loadIntelligence } from "@/lib/intelligence/service";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await identity()))
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  const result = await loadIntelligence();
  return Response.json(result, {
    status: result.error ? 503 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
