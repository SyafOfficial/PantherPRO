import { authFetch } from "./auth-fetch";

export const WORKSPACE_READ_TIMEOUT_MS = 10000;
const READ_RPCS = new Set([
  "client_access_allowed",
  "get_intelligence_inputs",
  "get_market_snapshot",
  "get_member_signal_summary",
  "get_admin_signal_performance",
]);

/** Bound workspace reads, including streamed response bodies. Never retry writes. */
export async function workspaceFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = WORKSPACE_READ_TIMEOUT_MS,
) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const read =
    url.pathname.startsWith("/rest/v1/") &&
    (["GET", "HEAD"].includes(method) ||
      (method === "POST" &&
        url.pathname.startsWith("/rest/v1/rpc/") &&
        READ_RPCS.has(url.pathname.slice("/rest/v1/rpc/".length))));
  if (!read) return authFetch(input, init);
  const deadline = AbortSignal.timeout(timeoutMs);
  const inherited =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetch(input, {
    ...init,
    signal: inherited ? AbortSignal.any([inherited, deadline]) : deadline,
  });
}
