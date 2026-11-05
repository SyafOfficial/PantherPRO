/** Bound individual Auth requests, including response-body reads, without logging credentials. */
export const AUTH_REQUEST_TIMEOUT_MS = 12000;
export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = input instanceof Request ? input.url : String(input);
  if (!new URL(url).pathname.startsWith("/auth/v1/")) return fetch(input, init);
  const signal = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS);
  const inherited =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetch(input, {
    ...init,
    signal: inherited ? AbortSignal.any([inherited, signal]) : signal,
  });
}
