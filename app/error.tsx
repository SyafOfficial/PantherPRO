"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="eyebrow">PANTHER FX</div>
        <h1>Connection interrupted.</h1>
        <p>Your workspace could not load. Please retry or reload the app.</p>
        <button className="primary-button" onClick={reset}>
          Try again
        </button>
        <a className="secondary-button" href="">
          Reload App
        </a>
      </section>
    </main>
  );
}
