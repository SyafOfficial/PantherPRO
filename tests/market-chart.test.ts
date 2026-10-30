import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MT5Chart from "../components/mt5-chart";
import type { MT5Display } from "../lib/engine/display";
test("real chart draws supplied broker candles and changes bid line only when quote changes", () => {
  const data: MT5Display = {
    symbol: "XAUUSD.V",
    timeframe: "H1",
    time_basis: "broker_server",
    quote: {
      bid: 3904.35,
      ask: 3904.73,
      observed_at: "2026-10-30T15:45:00Z",
      received_at: "2026-10-30T15:45:01Z",
      source_name: "Vestrado MT5",
      max_gap_seconds: 30,
    },
    bars: [
      {
        opened_at_server_raw: 1793383200,
        open: 3900,
        high: 3910,
        low: 3890,
        close: 3905,
      },
    ],
    exported_at: "2026-10-30T15:45:00Z",
    refresh_seconds: 10,
    chart_kind: "completed_broker_candles_and_observed_bid",
  };
  const render = (d: MT5Display, fresh = true) =>
    renderToStaticMarkup(React.createElement(MT5Chart, { data: d, fresh }));
  const html = render(data);
  assert.match(html, /Actual Vestrado XAUUSD.V H1/);
  assert.match(html, /3904\.35/);
  assert.match(html, /O 3900 H 3910 L 3890 C 3905/);
  assert.doesNotMatch(html, /DEMO|Fictional|2,346\.80/);
  const next = render({
    ...data,
    quote: { ...data.quote, bid: 3906.2, ask: 3906.5 },
  });
  assert.notEqual(html, next);
  assert.match(next, /3906\.20/);
  assert.match(render(data, false), /Last received bid is stale/);
});
