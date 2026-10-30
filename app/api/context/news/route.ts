import { identity } from "@/lib/supabase";
import { officialNews } from "@/lib/official-news";
export const dynamic = "force-dynamic";
let cached: { until: number; value: ReturnType<typeof officialNews> } | null =
  null;
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!(await identity()))
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  if (!cached || Date.now() >= cached.until)
    cached = { until: Date.now() + 60000, value: officialNews() };
  return Response.json(await cached.value, { headers });
}
