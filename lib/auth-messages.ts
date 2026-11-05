export function authFailureMessage(
  error: { code?: string; status?: number; name?: string },
  mode: "signup" | "login" | "resend",
) {
  if (
    error.status === 0 ||
    (error.status ?? 0) >= 500 ||
    error.name === "AuthRetryableFetchError"
  )
    return "The sign-in service is taking too long. Please wait a moment and retry. Your password has not been changed.";
  if (error.code === "over_email_send_rate_limit")
    return "The email service has reached its sending limit. Please retry later or contact Panther FX support. Repeating registration will not send an email sooner.";
  if (error.code === "over_request_rate_limit" || error.status === 429)
    return "Too many requests. Wait at least 60 seconds before trying again. If the limit remains, contact Panther FX support.";
  if (
    error.code === "email_address_not_authorized" ||
    error.code === "unexpected_failure"
  )
    return "Email delivery is unavailable. Please contact Panther FX support before retrying.";
  if (error.code === "email_not_confirmed")
    return "Please confirm your email before signing in. Check Spam/Junk, or use Resend confirmation below.";
  return mode === "login"
    ? "Unable to sign in. Check your credentials and email confirmation, or try again later."
    : mode === "resend"
      ? "Unable to request a confirmation email. Please retry later or contact support."
      : "Unable to create an account. Check your details, retry later or contact support.";
}
