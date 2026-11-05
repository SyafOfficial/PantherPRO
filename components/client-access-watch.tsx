"use client";
import { useEffect } from "react";
export default function ClientAccessWatch({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let running = false;
    const check = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const response = await fetch("/api/account/access", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok && (await response.json()).allowed === false)
          window.location.replace("/onboarding");
        else if (response.status === 401) window.location.replace("/login");
      } catch {
        /* A network outage does not imply revocation. */
      } finally {
        running = false;
      }
    };
    void check();
    const timer = setInterval(check, 60000);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled]);
  return null;
}
