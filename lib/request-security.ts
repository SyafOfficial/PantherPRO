export function sameOriginMutation(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return false;
    const incoming = new URL(origin);
    // Next may construct request.url using its bind address (0.0.0.0), so compare
    // the browser origin against the actual Host header, never that bind address.
    const host = request.headers.get("host");
    const forwarded = request.headers.get("x-forwarded-proto");
    const protocol =
      forwarded === "https" || forwarded === "http"
        ? `${forwarded}:`
        : new URL(request.url).protocol;
    return (
      incoming.origin === origin &&
      incoming.host === host &&
      incoming.protocol === protocol
    );
  } catch {
    return false;
  }
}
