import PantherLoader from "@/components/panther-loader";
export default function Loading() {
  return (
    <div className="route-loading-screen">
      <PantherLoader />
      <div className="loading-recovery">
        <p>Taking Longer Than Expected?</p>
        <a href="">Reload Workspace</a>
      </div>
    </div>
  );
}
