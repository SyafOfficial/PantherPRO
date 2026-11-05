"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function PerformanceRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => router.refresh()}
    >
      Refresh
    </button>
  );
}
