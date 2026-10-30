import { identity } from "@/lib/supabase";
import {
  CALENDAR_REFRESH_SECONDS,
  forexFactoryCalendar,
} from "@/lib/forex-factory";
export const dynamic = "force-dynamic";
let cached: {
  until: number;
  value: Promise<Awaited<ReturnType<typeof forexFactoryCalendar>> | null>;
} | null = null;
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!(await identity()))
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  // Cache failures too: repeated visitors must not hammer the upstream feed.
  if (!cached || Date.now() >= cached.until)
    cached = {
      until: Date.now() + CALENDAR_REFRESH_SECONDS * 1000,
      value: forexFactoryCalendar().catch(() => null),
    };
  const calendar = await cached.value;
  return calendar
    ? Response.json(calendar, { headers })
    : Response.json(
        { error: "Forex Factory calendar unavailable" },
        { status: 503, headers },
      );
}
