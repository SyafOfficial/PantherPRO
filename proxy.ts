import { authFetch } from "./lib/auth-fetch";
import { authRecovery } from "./lib/auth-recovery";
import { productionIssues, publicOrigin } from "./lib/deployment";
import { contentPolicy } from "./lib/content-policy";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-panther-auth-unavailable");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const secure = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", policy);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  if (
    productionIssues(process.env).length &&
    !["/api/health", "/api/ready"].includes(request.nextUrl.pathname)
  )
    return secure(
      NextResponse.json(
        {
          error:
            "Production configuration is incomplete. Demo content is not served in production.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    );
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  )
    return secure(response);
  if (
    ["/", "/api/health"].includes(request.nextUrl.pathname) ||
    (request.nextUrl.pathname === "/login" && request.method !== "GET")
  )
    return secure(response);
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      global: { fetch: authFetch },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          requestHeaders.set("cookie", request.cookies.toString());
          response = NextResponse.next({
            request: { headers: requestHeaders },
          });
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { error } = await db.auth
    .getClaims()
    .catch(() => ({ error: { status: 503 } }));
  const recovery = authRecovery(error);
  if (recovery === "sign_in") {
    // A login GET with invalid credentials must display the form, not redirect
    // to itself. Preserve SDK cookie cleanup from this refresh attempt.
    if (request.nextUrl.pathname === "/login") return secure(response);
    const expired = request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json(
          { error: "Session expired. Please sign in again." },
          { status: 401 },
        )
      : NextResponse.redirect(
          new URL(
            "/login?message=Your+session+expired.+Please+sign+in+again.",
            publicOrigin(process.env, request.nextUrl.origin),
          ),
          303,
        );
    for (const cookie of response.cookies.getAll()) expired.cookies.set(cookie);
    return secure(expired);
  }
  if (recovery === "unavailable") {
    if (request.nextUrl.pathname === "/login") {
      requestHeaders.set("x-panther-auth-unavailable", "1");
      const login = NextResponse.next({ request: { headers: requestHeaders } });
      for (const cookie of response.cookies.getAll()) login.cookies.set(cookie);
      return secure(login);
    }
    const unavailable = request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json(
          { error: "Authentication is temporarily unavailable. Please retry." },
          { status: 503 },
        )
      : new NextResponse(
          '<!doctype html><html lang="en" style="background:#090a0f;color-scheme:dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panther FX · Reconnect</title><body style="background:#090a0f;color:#f5f5f7;font-family:system-ui;margin:0;min-height:100svh;display:grid;place-items:center"><main style="padding:32px;text-align:center"><p style="color:#d9b66f;letter-spacing:4px">PANTHER FX</p><h1>Let’s Reconnect.</h1><p>The sign-in service is temporarily unavailable. Please retry shortly.</p><a href="/login" style="color:#d9b66f">Return To Sign In</a></main></body></html>',
          {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
    unavailable.headers.set("Cache-Control", "no-store");
    unavailable.headers.set("Retry-After", "5");
    // Stop here: forwarding would repeat the same failing refresh in the page.
    return secure(unavailable);
  }
  return secure(response);
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon(?:-192\\.png|-512\\.png|-maskable\\.svg|\\.svg)|manifest.webmanifest|sw.js|api/bridge/(?:mt5|clients)/?$).*)",
  ],
};
