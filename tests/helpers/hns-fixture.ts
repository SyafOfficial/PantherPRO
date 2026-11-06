export function hnsFixture(buy = false, slope = 0) {
  const values = [
    88, 89, 90, 91, 92, 93, 94, 95, 96, 98, 100, 103, 106, 103, 100, 97, 94, 97,
    102, 108, 114, 108, 102, 97, 94, 97, 100, 103, 106, 103, 100, 98, 97, 96,
    92,
  ];
  const bars = values.map((v, i) => ({
    opened_at_server_raw: 100000 + i * 900,
    open: v,
    high: v + 0.2,
    low: v - 0.2,
    close: v,
  }));
  if (slope)
    for (let i = 0; i < bars.length; i++)
      for (const k of ["open", "high", "low", "close"] as const)
        bars[i][k] += slope * (i - 16);
  const setupEnd = bars.at(-1)!.opened_at_server_raw + 900;
  const neck = 93.8 + slope * ((setupEnd + 300 - 100000) / 900 - 16);
  const m5 = Array.from({ length: 12 }, (_, i) => ({
    opened_at_server_raw: setupEnd - 3000 + i * 300,
    open: neck - 1.5,
    high: neck - 1,
    low: neck - 2,
    close: neck - 1.5,
  }));
  Object.assign(m5.at(-2)!, {
    open: neck - 0.5,
    high: neck - 0.3,
    low: neck - 1,
    close: neck - 0.8,
  });
  Object.assign(m5.at(-1)!, {
    open: neck - 0.2,
    high: neck + 0.2,
    low: neck - 1.8,
    close: neck - 1.6,
  });
  if (buy) {
    const mirror = (b: (typeof bars)[number]) => ({
      ...b,
      open: 300 - b.open,
      close: 300 - b.close,
      high: 300 - b.low,
      low: 300 - b.high,
    });
    return {
      bars: bars.map(mirror),
      m5: m5.map(mirror),
      setupEnd,
      server: setupEnd + 600,
    };
  }
  return { bars, m5, setupEnd, server: setupEnd + 600 };
}

export function hnsSnapshot(buy = false, slope = 0, now = Date.now()) {
  const f = hnsFixture(false, slope);
  const server = Math.floor(now / 1000) + 7200;
  const shift = server - f.server;
  const decorate = (b: (typeof f.bars)[number]) => ({
    ...b,
    opened_at_server_raw: b.opened_at_server_raw + shift,
    tick_volume: 100,
    real_volume: null,
    spread_points: 10,
  });
  const context = [
    120, 121, 125, 121, 110, 115, 120, 115, 105, 110, 115, 110, 100, 105, 110,
    105, 90, 99, 100, 99,
  ];
  const series = [
    { timeframe: "M5", availability: "available", candles: f.m5.map(decorate) },
    {
      timeframe: "M15",
      availability: "available",
      candles: f.bars.map(decorate),
    },
    {
      timeframe: "M30",
      availability: "available",
      candles: context.map((v, i) =>
        decorate({
          opened_at_server_raw: f.server - (context.length - i) * 1800,
          open: v,
          close: v,
          high: v + 0.2,
          low: v - 0.2,
        }),
      ),
    },
    ...[
      ["H1", 3600, 85],
      ["H4", 14400, 80],
    ].map(([timeframe, step, level]) => ({
      timeframe,
      availability: "available",
      candles: Array.from({ length: 5 }, (_, i) =>
        decorate({
          opened_at_server_raw: f.server - (5 - i) * Number(step),
          open: 100,
          close: 100,
          high: 101,
          low: i === 2 ? Number(level) : 99,
        }),
      ),
    })),
    ...["W1", "MN1"].map((timeframe) => ({
      timeframe,
      availability: "unavailable",
      candles: [],
    })),
  ];
  if (buy)
    for (const s of series)
      for (const b of s.candles)
        Object.assign(b, {
          open: 300 - b.open,
          close: 300 - b.close,
          high: 300 - b.low,
          low: 300 - b.high,
        });
  const c = series[0].candles.at(-1)!;
  const entry = c.close;
  return {
    schema: "panther.mt5.snapshot.v1",
    provider: "Vestrado MT5",
    symbol: "XAUUSD.V",
    exported_at_utc: new Date(Math.floor(now / 1000) * 1000)
      .toISOString()
      .slice(0, 19)
      .replace(/-/g, ".")
      .replace("T", " "),
    bar_time_basis: "broker_server",
    server_time_raw: server,
    digits: 2,
    point: 0.01,
    quote: {
      bid: buy ? entry - 0.1 : entry,
      ask: buy ? entry : entry + 0.1,
      last_tick_time_raw: server,
      last_tick_time_msc_raw: server * 1000,
    },
    series,
    ask_m5: series[0].candles.map((b) => ({
      ...b,
      open: b.open + 0.1,
      high: b.high + 0.1,
      low: b.low + 0.1,
      close: b.close + 0.1,
    })),
    order_book: null,
    aggressive_buy_sell_imbalance: null,
    execution_enabled: false,
  };
}
