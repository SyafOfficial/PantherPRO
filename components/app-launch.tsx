"use client";
import { useEffect, useState, type ReactNode } from "react";
import PantherLoader from "./panther-loader";

export default function AppLaunch({ children }: { children: ReactNode }) {
  const [launching, setLaunching] = useState(true);
  useEffect(() => {
    // Visual dwell only: data, authentication and notification work start normally.
    const timer = window.setTimeout(() => setLaunching(false), 1800);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={launching ? "app-launch is-launching" : "app-launch"}>
      {launching && (
        <div className="app-launch-screen">
          <PantherLoader />
        </div>
      )}
      <div className="app-launch-content">{children}</div>
    </div>
  );
}
