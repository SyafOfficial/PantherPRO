import { identity } from "@/lib/supabase";
import { serviceDb } from "@/lib/service-db";
import {
  DISPLAY_FRAMES,
  frameIndex,
  displaySnapshot,
} from "@/lib/engine/display";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!(await identity()))
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  const frame = new URL(request.url).searchParams.get("timeframe") ?? "H1";
  if (!DISPLAY_FRAMES.includes(frame as (typeof DISPLAY_FRAMES)[number]))
    return Response.json(
      { error: "Unsupported chart timeframe" },
      { status: 400, headers },
    );
  const selected = frame as (typeof DISPLAY_FRAMES)[number],
    i = frameIndex[selected];
  // Publish only requested market fields, never the complete private bridge payload.
  const { data, error } = await serviceDb()
    .from("mt5_bridge_latest")
    .select(
      `received_at,exported_at,source:snapshot->provider,symbol:snapshot->symbol,quote:snapshot->quote,server_time_raw:snapshot->server_time_raw,timeframe:snapshot->series->${i}->timeframe,candles:snapshot->series->${i}->candles`,
    )
    .eq("source", "vestrado")
    .single();
  if (error || !data)
    return Response.json(
      { error: "MT5 feed unavailable" },
      { status: 503, headers },
    );
  try {
    return Response.json(displaySnapshot(data, selected), { headers });
  } catch {
    return Response.json(
      { error: "MT5 chart data unavailable or invalid" },
      { status: 503, headers },
    );
  }
}
