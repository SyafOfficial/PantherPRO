import { XAUUSD_NEWS_GUIDE } from "@/lib/news-context";
export default function NewsGuide() {
  return (
    <section className="panel content-panel news-guide">
      <div className="eyebrow">XAUUSD · FUNDAMENTAL PLAYBOOK</div>
      <h2>Fed policy & the releases that move gold</h2>
      <p>
        Educational scenarios for Fed rates, FOMC, NFP, CPI, PPI and PMI. These
        explain possible transmission through USD and yields; they are not live
        releases, price predictions or signals.
      </p>
      <div className="news-guide-grid">
        {XAUUSD_NEWS_GUIDE.map((profile) => (
          <details key={profile.kind}>
            <summary>{profile.label}</summary>
            <p>{profile.focus}</p>
            <h3>
              {profile.format === "communication"
                ? "More hawkish than expected"
                : "Above consensus"}
            </h3>
            <p>{profile.above}</p>
            <h3>
              {profile.format === "communication"
                ? "More dovish than expected"
                : "Below consensus"}
            </h3>
            <p>{profile.below}</p>
            <h3>Expected / balanced outcome</h3>
            <p>{profile.inline}</p>
            <ul>
              {profile.checkpoints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
