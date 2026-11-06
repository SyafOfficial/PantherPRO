import PantherLoader from "@/components/panther-loader";
export default function Loading() {
  return (
    <div className="route-loading-screen">
      <div className="route-loading-brand">
        <PantherLoader />
      </div>
      <div className="route-loading-fallback">
        <section className="panel auth-card">
          <div className="eyebrow">PANTHER FX</div>
          <h1>Workspace is taking longer.</h1>
          <p>
            The connection has not completed. Retry your workspace, or return to
            sign in if your session has expired.
          </p>
          <div className="settings-actions">
            <a href="" className="primary-button">
              Retry workspace
            </a>
            <a href="/login" className="secondary-button">
              Return to sign in
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
