import Link from "next/link";
import { isConfigured } from "@/lib/supabase";
import { requestReset } from "./actions";
export default async function Forgot({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="eyebrow">PANTHER FX · ACCOUNT RECOVERY</div>
        <h1>Restore your access.</h1>
        <p>
          Request a secure email link. Links expire and can only be used once.
        </p>
        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}
        <form action={requestReset} className="form">
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
          <button className="primary-button" disabled={!isConfigured()}>
            Request recovery link
          </button>
        </form>
        {!isConfigured() && <p>Recovery is unavailable in demo mode.</p>}
        <Link className="secondary-button" href="/login">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
