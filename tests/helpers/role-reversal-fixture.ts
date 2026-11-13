import { baseSnapshot } from "./base-fixture";
/** Last two touches share the old resistance; older wick is deliberately deeper. */
export function roleReversalSnapshot(buy = true, now = Date.now()) {
  const s = baseSnapshot(true, false, now);
  const bars = s.series[1].candles;
  Object.assign(bars[25], { open: 70, close: 70, high: 72.2, low: 60 });
  Object.assign(bars[26], { open: 71.8, close: 72, high: 72.2, low: 65 });
  const m5 = s.series[0].candles;
  for (const b of m5)
    Object.assign(b, { open: 73, close: 73, high: 73.2, low: 72.5 });
  Object.assign(m5.at(-2)!, { high: 73.2 });
  Object.assign(m5.at(-1)!, { open: 72.4, close: 73.9, high: 74.2, low: 72 });
  s.quote.bid = 73.4;
  s.quote.ask = 73.5;
  if (!buy) {
    for (const b of [...bars, ...m5])
      Object.assign(b, {
        open: 300 - b.open,
        close: 300 - b.close,
        high: 300 - b.low,
        low: 300 - b.high,
      });
    for (const series of s.series.slice(2))
      for (const b of series.candles)
        Object.assign(b, {
          open: 300 - b.open,
          close: 300 - b.close,
          high: 300 - b.low,
          low: 300 - b.high,
        });
    s.quote.bid = 226.5;
    s.quote.ask = 226.6;
  }
  s.ask_m5 = m5.map((b) => ({
    ...b,
    open: b.open + 0.1,
    close: b.close + 0.1,
    high: b.high + 0.1,
    low: b.low + 0.1,
  }));
  return s;
}
