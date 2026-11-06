import { clientAccessAllowed } from "@/lib/clients/access";
import { isConfigured, supabase } from "@/lib/supabase";
import { serviceDb } from "@/lib/service-db";
import { authRecovery } from "@/lib/auth-recovery";
import {
  DISPLAY_FRAMES,
  frameIndex,
  displaySnapshot,
} from "@/lib/engine/display";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!isConfigured())
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  // Verify the user without fetching unrelated profile or MFA metadata per poll.
  const db = await supabase();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError && authRecovery(authError) === "unavailable")
    return Response.json(
      { error: "Authentication is temporarily unavailable. Retrying is safe." },
      { status: 503, headers },
    );
  if (authError || !user)
    return Response.json(
      { error: "Sign in required" },
      { status: 401, headers },
    );
  let allowed: boolean;
  try {
    allowed = await clientAccessAllowed();
  } catch {
    return Response.json(
      { error: "Membership verification is temporarily unavailable" },
      { status: 503, headers },
    );
  }
  if (!allowed)
    return Response.json(
      { error: "Membership verification required" },
      { status: 403, headers },
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
