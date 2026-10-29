"use client";
import { useActionState } from "react";
import {
  enrollTotp,
  verifyTotp,
  type EnrollmentState,
} from "@/app/account/security/actions";
export default function MfaEnrollment({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<EnrollmentState, FormData>(
    enrollTotp,
    {},
  );
  return (
    <section className="panel content-panel">
      <h2>Add an authenticator</h2>
      <p>
        Scan the QR code with your authenticator app, then verify a six-digit
        code. Keep the setup key private.
      </p>
      <form action={action}>
        <button className="primary-button" disabled={!enabled || pending}>
          Set up authenticator
        </button>
      </form>
      {state.error && (
        <div className="error-message" role="alert">
          {state.error}
        </div>
      )}
      {state.qrCode && state.factorId && (
        <div className="mfa-setup">
          <img
            src={
              state.qrCode.startsWith("data:")
                ? state.qrCode
                : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.qrCode)}`
            }
            alt="Private authenticator enrollment QR code"
          />
          <details>
            <summary>Enter the setup key manually</summary>
            <code>{state.secret}</code>
          </details>
          <form action={verifyTotp} className="form">
            <input type="hidden" name="factor_id" value={state.factorId} />
            <label>
              Authenticator code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                maxLength={6}
              />
            </label>
            <button className="primary-button">Verify new authenticator</button>
          </form>
        </div>
      )}
    </section>
  );
}
