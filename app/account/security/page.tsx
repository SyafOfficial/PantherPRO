import Link from "next/link";
import { identity, supabase } from "@/lib/supabase";
import { verifyTotp, removeTotp } from "./actions";
import MfaEnrollment from "@/components/mfa-enrollment";
export const dynamic = "force-dynamic";
export default async function Security({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const user = await identity();
  const db = user ? await supabase() : null;
  const { message } = await searchParams;
  const factors = db
    ? ((await db.auth.mfa.listFactors()).data?.all.filter(
        (f) => f.factor_type === "totp",
      ) ?? [])
    : [];
  return (
    <main className="account-page">
      <Link href="/account" className="text-button">
        ← Account
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PANTHER FX · ACCOUNT SECURITY</div>
          <h1>Two-factor protection.</h1>
          <p>
            Administrators must verify an authenticator before using privileged
            tools.
          </p>
        </div>
      </div>
      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}
      {!user && (
        <div className="message">
          Sign in to a configured account to manage authenticators.
        </div>
      )}
      {user && (
        <div className="panel content-panel">
          <h2>Session assurance: {user.aal}</h2>
          <p>
            Your role: {user.role}. Two-factor verification does not grant an
            administrator role.
          </p>
          {user.role === "admin" && user.aal === "aal2" && (
            <Link className="primary-button" href="/admin">
              Open administration
            </Link>
          )}
        </div>
      )}
      {factors.map((f) => (
        <section className="panel content-panel" key={f.id}>
          <h2>{f.friendly_name || "Authenticator"}</h2>
          <p>Status: {f.status}</p>
          {f.status === "verified" && (
            <form action={verifyTotp} className="form">
              <input type="hidden" name="factor_id" value={f.id} />
              <label>
                Six-digit code
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                  maxLength={6}
                />
              </label>
              <button className="primary-button">Verify this session</button>
            </form>
          )}
          <form action={removeTotp}>
            <input type="hidden" name="factor_id" value={f.id} />
            <button className="secondary-button">Remove factor</button>
          </form>
        </section>
      ))}
      <MfaEnrollment enabled={Boolean(user)} />
      <Link href="/account/password" className="secondary-button">
        Change password
      </Link>
    </main>
  );
}
