import Link from "next/link";
import { redirect } from "next/navigation";
import { identity, supabase } from "@/lib/supabase";
import { credentialReady } from "@/lib/clients/crypto";
import { submitApplication, updateConnection } from "./actions";
import AuthSubmit from "@/components/auth-submit";
export const dynamic = "force-dynamic";
export default async function Onboarding({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const user = await identity();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin/clients");
  const { data: application, error } = await (
    await supabase()
  )
    .from("client_applications")
    .select(
      "status,reason,revision,full_name,mt5_login,server,approved_at,last_checked_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const { message } = await searchParams;
  const locked =
    Boolean(application && application.status !== "pending") ||
    Boolean(application);
  return (
    <main className="auth-page">
      <section className="panel auth-card client-onboarding">
        <Link href="/" className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            PANTHER <span className="gold">FX</span>
          </span>
        </Link>
        <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
        <h1>{application ? "Your membership." : "Begin your journey."}</h1>
        <p>Connect your Vestrado account to verify your membership.</p>
        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}
        {error && (
          <div className="error-message">
            Your application could not be loaded. Please retry.
          </div>
        )}
        {application ? (
          <>
            <div className="client-status">
              <span className="outline-tag">
                {application.status.toUpperCase()}
              </span>
              <h2>{application.full_name}</h2>
              <p>Account {application.mt5_login}</p>
              <p>
                {application.status === "approved"
                  ? "Your membership has been approved."
                  : application.status === "revoked"
                    ? "Your access is paused. Contact the administrator for a review."
                    : "Your details have been received. Verification is pending."}
              </p>
            </div>
            {application.status === "approved" && (
              <Link href="/dashboard" className="primary-button">
                Enter your workspace →
              </Link>
            )}
            {application.status !== "revoked" && (
              <details className="client-terms">
                <summary>Update investor connection</summary>
                <p>
                  Correct your investor password here. Your account number,
                  access decision and activity dates remain unchanged.
                </p>
                <form action={updateConnection} className="form">
                  <input
                    type="hidden"
                    name="revision"
                    value={application.revision}
                  />
                  <label>
                    Vestrado server
                    <input value="Vestrado-Server" readOnly />
                  </label>
                  <label>
                    Investor password
                    <input
                      type="password"
                      name="investor_password"
                      autoComplete="off"
                      required
                      maxLength={128}
                    />
                  </label>
                  <label>
                    Confirm investor password
                    <input
                      type="password"
                      name="confirm_password"
                      autoComplete="off"
                      required
                      maxLength={128}
                    />
                  </label>
                  <small>
                    Read-only investor password only. Do not enter your
                    trading/master password.
                  </small>
                  <AuthSubmit
                    label="Update connection"
                    disabled={!credentialReady()}
                  />
                </form>
              </details>
            )}
            <small>
              For changes to your account number or personal details, contact
              the administrator.
            </small>
          </>
        ) : (
          <form action={submitApplication} className="form">
            <label>
              Full name
              <input
                name="full_name"
                autoComplete="name"
                required
                maxLength={120}
              />
            </label>
            <label>
              Email
              <input value={user.email ?? ""} readOnly type="email" />
            </label>
            <div className="client-form-grid">
              <label>
                Client ID
                <input name="client_id" required maxLength={80} />
              </label>
              <label>
                Phone number
                <input
                  name="phone"
                  autoComplete="tel"
                  type="tel"
                  required
                  maxLength={25}
                />
              </label>
            </div>
            <div className="client-form-grid">
              <label>
                MT5 account number
                <input
                  name="mt5_login"
                  inputMode="numeric"
                  pattern="[1-9][0-9]{3,19}"
                  required
                />
              </label>
              <label>
                Vestrado server
                <select name="server" required defaultValue="Vestrado-Server">
                  <option value="Vestrado-Server">Vestrado-Server</option>
                </select>
              </label>
            </div>
            <label>
              Investor password
              <input
                name="investor_password"
                type="password"
                autoComplete="off"
                required
                maxLength={128}
              />
            </label>
            <small>
              Use your read-only investor password. Never enter your
              trading/master password. Your authorised administrator can view
              these details.
            </small>
            <div className="client-terms">
              <strong>Membership requirements</strong>
              <p>
                Have at least USD300 in verified real cash deposits and at least
                USD300 in real account balance when applying, excluding bonuses.
                Existing capital qualifies; no new deposit is required. Do not
                withdraw before your first trade after approval. Membership
                requires trading activity within each seven-day period. An
                account exhausted by trading losses has a 31-day inactivity
                allowance.
              </p>
              <p>
                Trading losses alone do not cancel membership. No trade size or
                profit target is required.
              </p>
            </div>
            <label className="client-consent">
              <input type="checkbox" name="consent" value="yes" required />I own
              this account and authorise read-only monitoring of its
              transactions, balance and trading activity, storage of my details,
              administrator access to my investor password, and access decisions
              under these requirements.
            </label>
            <AuthSubmit
              label="Submit for verification"
              disabled={!credentialReady() || locked || Boolean(error)}
            />
            {!credentialReady() && (
              <small>Secure registration is being prepared.</small>
            )}
          </form>
        )}
        <Link href="/account" className="secondary-button">
          Account settings
        </Link>
      </section>
    </main>
  );
}
