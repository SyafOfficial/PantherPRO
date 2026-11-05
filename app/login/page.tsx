import Link from "next/link";
import { authenticate, resendConfirmation } from "./actions";
import AuthSubmit from "@/components/auth-submit";
import { isConfigured } from "@/lib/supabase";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; message?: string }>;
}) {
  const params = await searchParams;
  const signup = params.mode === "signup";
  return (
    <main className="auth-page">
      <Link href="/" className="brand">
        <img src="/icon.svg" alt="" />
        <span>
          PANTHER <span className="gold">FX</span>
          <small>INTELLIGENCE TERMINAL</small>
        </span>
      </Link>
      <section className="panel auth-card">
        <div className="eyebrow">YOUR PRIVATE PERSPECTIVE</div>
        <h1>{signup ? "Begin with perspective." : "Welcome back."}</h1>
        <p>A disciplined approach to market intelligence.</p>
        {!isConfigured() && (
          <div className="message">
            Demo mode · Account creation and sign-in require a configured
            Supabase project. Explore the read-only terminal without an account.
          </div>
        )}
        {params.message && (
          <div className="message" role="status">
            {params.message}
          </div>
        )}
        <>
          <div className="auth-tabs">
            <Link className={!signup ? "active" : ""} href="/login">
              Sign in
            </Link>
            <Link className={signup ? "active" : ""} href="/login?mode=signup">
              Create account
            </Link>
          </div>
          <Link href="/forgot-password" className="text-button">
            Forgot password?
          </Link>
          <form className="form" action={authenticate}>
            <input
              type="hidden"
              name="mode"
              value={signup ? "signup" : "login"}
            />
            {signup && (
              <label>
                Display name
                <input
                  name="name"
                  autoComplete="name"
                  maxLength={60}
                  required
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={12}
                maxLength={128}
                placeholder="At least 12 characters"
                required
              />
            </label>
            <AuthSubmit
              disabled={!isConfigured()}
              label={signup ? "Create account" : "Sign in securely"}
            />
          </form>
          <details style={{ marginTop: 18 }}>
            <summary className="text-button">
              Didn't receive your confirmation email?
            </summary>
            <form
              className="form"
              action={resendConfirmation}
              style={{ marginTop: 14 }}
            >
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
              <button className="secondary-button" disabled={!isConfigured()}>
                Resend confirmation
              </button>
              <small>
                Check Spam/Junk and the spelling of your address. Wait at least
                60 seconds between requests.
              </small>
            </form>
          </details>
          <p style={{ fontSize: 10, marginTop: 18 }}>
            Email confirmation is required. Account creation does not grant
            administrator privileges.
          </p>
        </>
        <Link href="/" className="secondary-button">
          Return to terminal
        </Link>
      </section>
    </main>
  );
}
