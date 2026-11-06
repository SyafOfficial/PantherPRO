"use client";
import { useEffect, useReducer, useRef } from "react";
import {
  chartFeedReducer,
  emptyChartFeed,
  selectedChartFeed,
} from "@/lib/chart-feed-state";
import type { MT5Display } from "@/lib/engine/display";

/** Session-local frame cache. Every refresh still passes server authentication and access checks. */
export function useMT5Feed(owner: string | null, frame: string) {
  const [state, dispatch] = useReducer(chartFeedReducer, emptyChartFeed);
  const sequence = useRef(0);
  useEffect(() => {
    if (!owner) {
      dispatch({ type: "reset" });
      return;
    }
    const request = { owner, frame, sequence: ++sequence.current };
    let stopped = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    dispatch({ type: "begin", ...request });
    const poll = async () => {
      if (document.hidden) {
        timer = setTimeout(poll, 2000);
        return;
      }
      const started = Date.now();
      const active = new AbortController();
      controller = active;
      const timeout = setTimeout(() => active.abort(), 8000);
      try {
        const response = await fetch(
          `/api/market/mt5?timeframe=${encodeURIComponent(frame)}`,
          {
            cache: "no-store",
            signal: active.signal,
          },
        );
        if (response.status === 401 || response.status === 403) {
          if (!stopped) dispatch({ type: "denied", ...request });
          return;
        } else {
          if (!response.ok) throw new Error("Chart request unavailable");
          const data = (await response.json()) as MT5Display;
          if (data.timeframe !== frame || data.symbol !== "XAUUSD.V")
            throw new Error("Mismatched chart");
          if (!stopped) dispatch({ type: "success", ...request, data });
        }
      } catch {
        if (!stopped) dispatch({ type: "failure", ...request });
      } finally {
        clearTimeout(timeout);
      }
      if (!stopped)
        timer = setTimeout(poll, Math.max(250, 2000 - (Date.now() - started)));
    };
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [owner, frame]);
  return selectedChartFeed(state, owner, frame);
}
