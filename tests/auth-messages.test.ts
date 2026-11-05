import { test } from "node:test";
import assert from "node:assert/strict";
import { authFailureMessage } from "../lib/auth-messages";
test("auth email limits surface sending-cap and cooldown messages without exposing account existence", () => {
  assert.match(
    authFailureMessage(
      { code: "over_email_send_rate_limit", status: 429 },
      "signup",
    ),
    /sending limit/,
  );
  assert.match(authFailureMessage({ status: 429 }, "resend"), /60 seconds/);
  assert.match(
    authFailureMessage({ code: "email_not_confirmed" }, "login"),
    /Resend confirmation/,
  );
  assert.match(
    authFailureMessage({ code: "email_address_not_authorized" }, "signup"),
    /delivery is unavailable/,
  );
  assert.doesNotMatch(
    authFailureMessage({ code: "user_already_exists" }, "signup"),
    /already exists/,
  );
});

test("Auth timeouts report service unavailability instead of blaming the password", () => {
  for (const error of [
    { status: 504 },
    { status: 0 },
    { name: "AuthRetryableFetchError" },
  ])
    assert.match(
      authFailureMessage(error, "login"),
      /service is taking too long/,
    );
});
