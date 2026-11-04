import { after } from "next/server";
import { identity } from "@/lib/supabase";
import { serviceDb } from "@/lib/service-db";
import { createCalendarDisplayRefresh } from "@/lib/calendar-display-cache";
export const dynamic = "force-dynamic";
let refresh: ReturnType<typeof createCalendarDisplayRefresh> | null = null;
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!(await identity()))
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  const db = serviceDb();
  refresh ??= createCalendarDisplayRefresh(db, {
    url:
      process.env.FF_CALENDAR_SOURCE === "weekly"
        ? undefined
        : process.env.FF_SCRAPER_API_URL,
    token: process.env.FF_SCRAPER_AUTH_TOKEN,
  });
  const read = () =>
    db
      .from("calendar_display_cache")
      .select("payload,fetched_at")
      .eq("singleton", true)
      .maybeSingle();
  let { data, error } = await read();
  if (error)
    return Response.json(
      { error: "Calendar cache unavailable" },
      { status: 503, headers },
    );
  if (!data) {
    try {
      await refresh();
      ({ data } = await read());
    } catch {
      /* No fabricated schedule when both sources fail. */
    }
  }
  if (!data)
    return Response.json(
      { error: "Calendar source unavailable; retry shortly" },
      { status: 503, headers },
    );
  const age = Date.now() - Date.parse(data.fetched_at);
  if (age > 15 * 60000)
    after(async () => {
      try {
        await refresh!();
      } catch {
        console.warn(
          "Calendar background refresh unavailable; last verified schedule retained.",
        );
      }
    });
  return Response.json(
    { ...data.payload, cache_status: age > 2 * 3600000 ? "stale" : "fresh" },
    { headers },
  );
}
