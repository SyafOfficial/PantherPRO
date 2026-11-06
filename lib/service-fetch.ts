import { workspaceFetch } from "./workspace-fetch";
export const SERVICE_WRITE_TIMEOUT_MS = 20000;
/** Bound service-side mutations without automatically retrying an unknown outcome.
 * Existing RPC fingerprints, revisions and leases decide whether a later retry is valid. */
export function serviceFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  if (!url.pathname.startsWith("/rest/v1/") || ["GET", "HEAD"].includes(method))
    return workspaceFetch(input, init);
  const inherited =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(SERVICE_WRITE_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: inherited ? AbortSignal.any([inherited, deadline]) : deadline,
  });
}
