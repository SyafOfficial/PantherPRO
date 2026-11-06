import { hnsSnapshot } from "./hns-fixture";
export function chFixture(buy = true, slope = 0) {
  const values = [
    90, 92, 94, 96, 98, 100, 103, 106, 104, 101, 98, 95, 93, 92, 91, 90, 89, 88,
    87, 86, 85, 86, 87, 88, 89, 90, 91, 92, 93, 95, 98, 101, 104, 106, 104, 102,
    100, 99, 100, 101, 103, 105, 108,
  ];
  const bars = values.map((v, i) => ({
    opened_at_server_raw: 100000 + i * 900,
    open: v + slope * (i - 7),
    close: v + slope * (i - 7),
    high: v + 0.2 + slope * (i - 7),
    low: v - 0.2 + slope * (i - 7),
  }));
  const end = bars.at(-1)!.opened_at_server_raw + 900;
  const rim = 106.2 + slope * ((end + 300 - 100000) / 900 - 7);
  const m5 = Array.from({ length: 12 }, (_, i) => ({
    opened_at_server_raw: end - 3000 + i * 300,
    open: rim + 1,
    close: rim + 1,
    high: rim + 1.5,
    low: rim + 0.5,
  }));
  Object.assign(m5.at(-2)!, {
    open: rim + 0.5,
    close: rim + 0.8,
    high: rim + 1,
    low: rim + 0.3,
  });
  Object.assign(m5.at(-1)!, {
    open: rim + 0.2,
    close: rim + 1.6,
    high: rim + 1.8,
    low: rim - 0.2,
  });
  if (!buy)
    for (const b of [...bars, ...m5])
      Object.assign(b, {
        open: 300 - b.open,
        close: 300 - b.close,
        high: 300 - b.low,
        low: 300 - b.high,
      });
  return { bars, m5, setupEnd: end, server: end + 600 };
}
export function chSnapshot(buy = true, slope = 0, now = Date.now()) {
  // Reuse target/alignment fixture mirrored around 150, then move prices to the CH rim.
  const raw = hnsSnapshot(buy, 0, now),
    f = chFixture(buy, slope),
    shift = raw.server_time_raw - f.server;
  const decorate = (b: (typeof f.bars)[number]) => ({
    ...b,
    opened_at_server_raw: b.opened_at_server_raw + shift,
    tick_volume: 100,
    real_volume: null,
    spread_points: 10,
  });
  raw.series[0].candles = f.m5.map(decorate);
  raw.series[1].candles = f.bars.map(decorate);
  // BUY CH rim ~106, targets must be above it; SELL mirror rim ~194, targets below it.
  const delta = buy ? -100 : 100;
  for (const s of raw.series.slice(2))
    for (const b of s.candles)
      for (const key of ["open", "close", "high", "low"] as const)
        b[key] += delta;
  const entry = raw.series[0].candles.at(-1)!.close;
  raw.quote.bid = buy ? entry - 0.1 : entry;
  raw.quote.ask = buy ? entry : entry + 0.1;
  raw.ask_m5 = raw.series[0].candles.map((b) => ({
    ...b,
    open: b.open + 0.1,
    close: b.close + 0.1,
    high: b.high + 0.1,
    low: b.low + 0.1,
  }));
  return raw;
}
