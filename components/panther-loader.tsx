export default function PantherLoader() {
  return (
    <div
      className="panther-loader"
      role="status"
      aria-label="Loading Panther FX"
    >
      <div className="panther-loader-mark">
        <span className="panther-loader-orbit" aria-hidden="true" />
        <img
          src="/icon.svg"
          alt=""
          width="120"
          height="120"
          fetchPriority="high"
        />
      </div>
      <p className="panther-loader-name">
        PANTHER <span>FX</span>
      </p>
      <span className="panther-loader-caption">Loading Your Workspace</span>
      <span className="panther-loader-line" aria-hidden="true" />
    </div>
  );
}
