"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="eyebrow">PANTHER FX</div>
        <h1>Connection interrupted.</h1>
        <p>
          The terminal could not load. Check your connection and Supabase
          configuration, then retry. No market data has been substituted.
        </p>
        <button className="primary-button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
