import Link from "next/link";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Compass,
  ShieldCheck,
} from "lucide-react";

export default function Home() {
  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <Link href="/" className="brand" aria-label="Panther FX home">
          <img src="/icon.svg" alt="" />
          <span>
            PANTHER <span className="gold">FX</span>
            <small>MARKET INTELLIGENCE</small>
          </span>
        </Link>
        <nav className="welcome-actions" aria-label="Member access">
          <Link href="/login" className="welcome-signin">
            Log in
          </Link>
          <Link href="/login?mode=signup" className="secondary-button">
            Register <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main>
        <section className="welcome-hero">
          <div className="welcome-copy">
            <p className="eyebrow">THE PANTHER PERSPECTIVE</p>
            <h1>
              A clearer view.
              <br />
              <span>A considered move.</span>
            </h1>
            <p className="welcome-intro">
              Gold intelligence, market context and a disciplined perspective. A
              private workspace for the considered trader.
            </p>
            <div className="welcome-actions welcome-hero-actions">
              <Link href="/login?mode=signup" className="primary-button">
                Begin your membership{" "}
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/login" className="secondary-button">
                Member login
              </Link>
            </div>
            <p className="welcome-note">
              Your dashboard opens after account verification and membership
              approval.
            </p>
          </div>
          <div className="welcome-emblem" aria-hidden="true">
            <div className="welcome-emblem-ring">
              <img src="/icon.svg" alt="" />
            </div>
            <span>CONTEXT BEFORE CONVICTION</span>
          </div>
        </section>
        <section
          className="welcome-features"
          aria-label="Inside your membership"
        >
          {[
            {
              Icon: ChartNoAxesCombined,
              title: "A focused perspective",
              copy: "Gold signals and market structure, brought into one considered view.",
            },
            {
              Icon: Compass,
              title: "Context for your session",
              copy: "Market analysis, economic events and session schedules in one workspace.",
            },
            {
              Icon: ShieldCheck,
              title: "A private workspace",
              copy: "Create your account, connect your investor details and follow your verification status.",
            },
          ].map(({ Icon, title, copy }) => (
            <article key={title}>
              <Icon size={23} aria-hidden="true" />
              <h2>{title}</h2>
              <p>{copy}</p>
            </article>
          ))}
        </section>
        <section
          className="welcome-journey"
          aria-labelledby="membership-heading"
        >
          <div>
            <p className="eyebrow">YOUR MEMBERSHIP</p>
            <h2 id="membership-heading">One thoughtful step at a time.</h2>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Create your account</h3>
                <p>Register and confirm your email.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Complete verification</h3>
                <p>Submit your Vestrado investor connection for review.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Enter your dashboard</h3>
                <p>Access your workspace once membership is approved.</p>
              </div>
            </li>
          </ol>
        </section>
      </main>
      <footer className="welcome-footer">
        <span>PANTHER FX · INTELLIGENCE TERMINAL</span>
        <p>
          Trading involves risk. Market intelligence does not guarantee
          outcomes.
        </p>
        <Link href="/guide">
          Explore the guide <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
