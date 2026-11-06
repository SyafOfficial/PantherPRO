import Link from "next/link";

export default function Home() {
  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <Link href="/" className="brand" aria-label="Panther FX home">
          <img src="/icon.svg" alt="" />
          <span>
            PANTHER <span className="gold">FX</span>
          </span>
        </Link>
      </header>
      <main className="welcome-main">
        <section className="welcome-entry" aria-labelledby="welcome-heading">
          <div className="welcome-rule" aria-hidden="true" />
          <h1 id="welcome-heading">Welcome.</h1>
          <nav className="welcome-actions" aria-label="Member access">
            <Link href="/login" className="primary-button">
              Log in
            </Link>
            <Link href="/login?mode=signup" className="secondary-button">
              Register
            </Link>
          </nav>
        </section>
      </main>
    </div>
  );
}
