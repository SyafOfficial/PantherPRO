import Link from "next/link";
import { authenticate } from "./actions";
import SignOutButton from "@/components/sign-out-button";
import { identity, isConfigured } from "@/lib/supabase";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; message?: string }>;
}) {
  const params = await searchParams;
  const signup = params.mode === "signup";
  const user = await identity();
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
        <h1>
          {user
            ? "Your account"
            : signup
              ? "Begin with perspective."
              : "Welcome back."}
        </h1>
        <p>
          {user
            ? `${user.email} · ${user.role} membership`
            : "A disciplined approach to market intelligence."}
        </p>
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
        {user ? (
          <>
            <SignOutButton />
            {user.role === "admin" && (
              <Link className="secondary-button" href="/admin">
                Administration
              </Link>
            )}
          </>
        ) : (
          <>
            <div className="auth-tabs">
              <Link className={!signup ? "active" : ""} href="/login">
                Sign in
              </Link>
              <Link
                className={signup ? "active" : ""}
                href="/login?mode=signup"
              >
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
              <button className="primary-button" disabled={!isConfigured()}>
                {signup ? "Create account" : "Sign in securely"}
              </button>
            </form>
            <p style={{ fontSize: 10, marginTop: 18 }}>
              Email confirmation is required. Account creation does not grant
              VIP or administrator privileges.
            </p>
          </>
        )}
        <Link href="/" className="secondary-button">
          Return to terminal
        </Link>
      </section>
    </main>
  );
}
