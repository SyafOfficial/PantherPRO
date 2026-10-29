import { productionIssues } from "./lib/deployment";
import { contentPolicy } from "./lib/content-policy";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const secure = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", policy);
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
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
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
  await db.auth.getUser();
  return secure(response);
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js).*)"],
};
