/** Outages and rate limits must retain the session; only terminal auth errors prompt sign-in. */
export function authRecovery(error: { status?: number } | null | undefined) {
  if (!error) return null;
  return [400, 401, 403, 422].includes(error.status ?? 0)
    ? "sign_in"
    : "unavailable";
}
