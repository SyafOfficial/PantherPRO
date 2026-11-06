import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartFeedReducer as reduce,
  emptyChartFeed,
  selectedChartFeed,
} from "../lib/chart-feed-state";
import type { MT5Display } from "../lib/engine/display";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MarketContext from "../components/market-context";
function data(timeframe: MT5Display["timeframe"]): MT5Display {
  return {
    symbol: "XAUUSD.V",
    timeframe,
    time_basis: "broker_server",
    exported_at: "2026-11-06T09:00:00Z",
    refresh_seconds: 2,
    chart_kind: "completed_broker_candles_and_observed_bid",
    bars: [],
    quote: {
      bid: 4000,
      ask: 4000.2,
      observed_at: "2026-11-06T09:00:00Z",
      received_at: "2026-11-06T09:00:00Z",
      source_name: "Vestrado MT5",
      max_gap_seconds: 30,
    },
  };
}
const request = (frame: string, sequence: number, owner = "client-a") => ({
  frame,
  sequence,
  owner,
});
test("a first frame loads honestly and revisiting a frame restores its own cached candles immediately", () => {
  const h1 = request("H1", 1),
    d1 = request("D1", 2);
  let state = reduce(emptyChartFeed, { type: "begin", ...h1 });
  assert.equal(selectedChartFeed(state, "client-a", "H1").loading, true);
  assert.equal(selectedChartFeed(state, "client-a", "H1").error, false);
  state = reduce(state, { type: "success", ...h1, data: data("H1") });
  const switching = selectedChartFeed(state, "client-a", "D1");
  assert.equal(switching.data, null);
  assert.equal(switching.loading, true);
  assert.equal(switching.latestQuote?.bid, 4000);
  state = reduce(state, { type: "begin", ...d1 });
  state = reduce(state, { type: "success", ...d1, data: data("D1") });
  const cached = selectedChartFeed(state, "client-a", "H1");
  assert.equal(cached.data?.timeframe, "H1");
  assert.equal(cached.loading, true);
  assert.equal(cached.error, false);
  assert.equal(selectedChartFeed(state, "client-a", "__proto__").data, null);
});
test("late responses and superseded failures cannot overwrite a newly selected timeframe", () => {
  const old = request("H1", 1),
    current = request("D1", 2);
  let state = reduce(emptyChartFeed, { type: "begin", ...old });
  state = reduce(state, { type: "begin", ...current });
  assert.equal(
    reduce(state, { type: "success", ...old, data: data("H1") }),
    state,
  );
  assert.equal(reduce(state, { type: "failure", ...old }), state);
  state = reduce(state, { type: "success", ...current, data: data("W1") });
  assert.equal(state.cache.D1, undefined);
  assert.equal(state.error, true);
});
test("temporary refresh failures retain the selected chart while a new selection resets its error", () => {
  const h1 = request("H1", 1);
  let state = reduce(emptyChartFeed, { type: "begin", ...h1 });
  state = reduce(state, { type: "success", ...h1, data: data("H1") });
  state = reduce(state, { type: "failure", ...h1 });
  assert.equal(
    selectedChartFeed(state, "client-a", "H1").data?.timeframe,
    "H1",
  );
  assert.equal(selectedChartFeed(state, "client-a", "H1").error, true);
  state = reduce(state, { type: "begin", ...request("D1", 2) });
  assert.equal(selectedChartFeed(state, "client-a", "D1").error, false);
});
test("identity changes and denied access clear cached charts and quotes", () => {
  const a = request("H1", 1),
    b = request("H1", 2, "client-b");
  let state = reduce(emptyChartFeed, { type: "begin", ...a });
  state = reduce(state, { type: "success", ...a, data: data("H1") });
  assert.equal(selectedChartFeed(state, "client-b", "H1").data, null);
  assert.equal(selectedChartFeed(state, "client-b", "H1").latestQuote, null);
  state = reduce(state, { type: "begin", ...b });
  assert.deepEqual(state.cache, {});
  assert.equal(
    reduce(state, { type: "success", ...a, data: data("H1") }),
    state,
  );
  state = reduce(state, { type: "success", ...b, data: data("H1") });
  state = reduce(state, { type: "denied", ...b });
  assert.deepEqual(state.cache, {});
  assert.equal(state.latest, null);
  assert.equal(selectedChartFeed(state, "client-b", "H1").accessDenied, true);
  state = reduce(state, { type: "begin", ...request("D1", 3, "client-b") });
  assert.equal(selectedChartFeed(state, "client-b", "D1").accessDenied, true);
});
test("Market Context says loading while awaiting a selected frame instead of declaring it unavailable", () => {
  const markup = renderToStaticMarkup(
    createElement(MarketContext, {
      data: null,
      fresh: false,
      timeframe: "D1",
      loading: true,
      onTimeframe() {},
    }),
  );
  assert.match(markup, /Loading D1 chart and analysis/);
  assert.match(markup, /Loading D1 indicators/);
  assert.doesNotMatch(markup, /Market history is currently unavailable/);
});
