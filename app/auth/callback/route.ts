import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/deployment";
import { safeAuthNext } from "@/lib/deployment";
import { supabase, isConfigured } from "@/lib/supabase";
export async function GET(request: NextRequest) {
  const origin = publicOrigin(
    process.env,
    `${request.nextUrl.protocol}//${request.headers.get("host") ?? ""}`,
  );
  const code = request.nextUrl.searchParams.get("code");
  if (code && isConfigured()) {
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeAuthNext(request.nextUrl.searchParams.get("next")), origin),
      );
  }
  return NextResponse.redirect(
    new URL(
      "/login?message=Confirmation+failed.+Please+try+signing+in.",
      origin,
    ),
  );
}
