export function fixture(breakout = false) {
  const values = [
    ...Array(10).fill(14),
    12,
    11,
    10,
    11,
    12,
    13,
    12,
    11,
    12,
    13,
    14,
    13,
    12,
  ];
  const setupBars = values.map((v, i) => ({
    opened_at_server_raw: 100000 + i * 900,
    open: v,
    high: v + 0.2,
    low: v - 0.2,
    close: v,
  }));
  Object.assign(
    setupBars.at(-1)!,
    breakout
      ? { open: 12.4, close: 11.1, high: 12.6, low: 10.8 }
      : { open: 11.9, close: 12.6, high: 12.8, low: 11.75 },
  );
  if (breakout)
    Object.assign(setupBars[20], {
      open: 12.6,
      close: 12.6,
      high: 14.2,
      low: 11.4,
    });
  const setupEnd = setupBars.at(-1)!.opened_at_server_raw + 900;
  const m5Bars = Array.from({ length: 17 }, (_, i) => ({
    opened_at_server_raw: setupEnd + 300 - (16 - i) * 300,
    open: breakout ? 11.6 : 12.2,
    close: breakout ? 11.6 : 12.2,
    high: breakout ? 11.8 : 12.4,
    low: breakout ? 11.4 : 11.9,
  }));
  Object.assign(
    m5Bars.at(-1)!,
    breakout
      ? { open: 11.8, close: 11.2, high: 12.1, low: 11.0 }
      : { open: 12.1, close: 12.7, high: 12.8, low: 12.0 },
  );
  return {
    setupBars,
    setupEnd,
    subsequentSetupBars: [],
    m5Bars,
    asOf: setupEnd + 600,
    higherTrend: breakout ? ("down" as const) : ("up" as const),
    bid: breakout ? 11.2 : 12.6,
    ask: breakout ? 11.25 : 12.65,
    point: 0.01,
    target: { buy: 20, sell: 5 },
  };
}
export function mirror(x: ReturnType<typeof fixture>) {
  const reflect = (b: (typeof x.setupBars)[number]) => ({
    ...b,
    open: 100 - b.open,
    close: 100 - b.close,
    high: 100 - b.low,
    low: 100 - b.high,
  });
  return {
    ...x,
    setupBars: x.setupBars.map(reflect),
    m5Bars: x.m5Bars.map(reflect),
    bid: 100 - x.ask,
    ask: 100 - x.bid,
    higherTrend: x.higherTrend === "up" ? ("down" as const) : ("up" as const),
    target: { buy: 95, sell: 80 },
  };
}
