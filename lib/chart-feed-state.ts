import type { MT5Display } from "./engine/display";

export type ChartFeedState = {
  owner: string | null;
  frame: string | null;
  sequence: number;
  cache: Record<string, MT5Display>;
  latest: MT5Display | null;
  loading: boolean;
  error: boolean;
  denied: boolean;
};
export const emptyChartFeed: ChartFeedState = {
  owner: null,
  frame: null,
  sequence: 0,
  cache: {},
  latest: null,
  loading: false,
  error: false,
  denied: false,
};
type RequestEvent = { owner: string; frame: string; sequence: number };
export type ChartFeedEvent =
  | { type: "reset" }
  | (RequestEvent & { type: "begin" | "failure" | "denied" })
  | (RequestEvent & { type: "success"; data: MT5Display });

export function chartFeedReducer(
  state: ChartFeedState,
  event: ChartFeedEvent,
): ChartFeedState {
  if (event.type === "reset") return emptyChartFeed;
  if (event.type === "begin") {
    const previous = state.owner === event.owner ? state : emptyChartFeed;
    return {
      ...previous,
      owner: event.owner,
      frame: event.frame,
      sequence: event.sequence,
      loading: true,
      error: false,
    };
  }
  if (
    event.owner !== state.owner ||
    event.frame !== state.frame ||
    event.sequence !== state.sequence
  )
    return state;
  if (event.type === "denied")
    return {
      ...state,
      cache: {},
      latest: null,
      loading: false,
      error: true,
      denied: true,
    };
  if (event.type === "failure")
    return { ...state, loading: false, error: true };
  if (event.type === "success") {
    if (event.data.timeframe !== event.frame)
      return { ...state, loading: false, error: true };
    return {
      ...state,
      cache: { ...state.cache, [event.frame]: event.data },
      latest: event.data,
      loading: false,
      error: false,
      denied: false,
    };
  }
  return state;
}

export function selectedChartFeed(
  state: ChartFeedState,
  owner: string | null,
  frame: string,
) {
  if (!owner || owner !== state.owner)
    return {
      data: null,
      latestQuote: null,
      loading: Boolean(owner),
      error: false,
      accessDenied: false,
    };
  return {
    data: Object.hasOwn(state.cache, frame) ? state.cache[frame] : null,
    latestQuote: state.latest?.quote ?? null,
    loading: state.frame !== frame || state.loading,
    error: state.frame === frame && state.error,
    accessDenied: state.denied,
  };
}
