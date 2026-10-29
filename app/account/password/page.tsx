import Link from "next/link";
import { identity, isConfigured } from "@/lib/supabase";
import { updatePassword } from "./actions";
export default async function Password({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const user = await identity();
  const { message } = await searchParams;
  return (
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="eyebrow">PANTHER FX · SECURITY</div>
        <h1>Choose a strong password.</h1>
        <p>
          {user
            ? "You must complete any verification required by your account before a password change."
            : "Sign in or follow a valid recovery email link to continue."}
        </p>
        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}
        <form className="form" action={updatePassword}>
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <button
            className="primary-button"
            disabled={!user || !isConfigured()}
          >
            Update password
          </button>
        </form>
        <Link href="/account" className="secondary-button">
          Account settings
        </Link>
      </section>
    </main>
  );
}
