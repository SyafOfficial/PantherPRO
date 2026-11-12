import { chSnapshot } from "./ch-fixture";
export function baseSnapshot(buy = true, choch = false, now = Date.now()) {
  const raw = chSnapshot(buy, 0, now),
    server = raw.server_time_raw,
    end = server - 600;
  const values = choch
    ? [
        90, 89, 85, 88, 89, 87, 83, 86, 87, 86, 84, 82, 85, 86, 84, 80, 83, 84,
        82, 78, 81, 82, 81.5, 81, 80.5, 80, 80.5, 86,
      ]
    : [
        60, 61, 65, 62, 61, 63, 67, 64, 63, 64, 66, 68, 65, 64, 66, 70, 67, 66,
        68, 72, 69, 68, 68.5, 69, 69.5, 70, 70.5, 74,
      ];
  const offset = choch ? 10 : 0;
  const bars = values.map((v, i) => ({
    opened_at_server_raw: end - (values.length - i) * 900,
    open: v,
    close: v,
    high: v + 0.2,
    low: v - 0.2,
    tick_volume: 100,
    real_volume: null,
    spread_points: 10,
  }));
  Object.assign(bars[26], {
    open: 70.8 + offset,
    close: 70.5 + offset,
    high: 71 + offset,
    low: 70.2 + offset,
  });
  Object.assign(bars[27], { open: 70.5 + offset, low: 70.3 + offset });
  const m5 = Array.from({ length: 12 }, (_, i) => ({
    opened_at_server_raw: end - 3000 + i * 300,
    open: 72 + offset,
    close: 72 + offset,
    high: 72.5 + offset,
    low: 71.5 + offset,
    tick_volume: 100,
    real_volume: null,
    spread_points: 10,
  }));
  Object.assign(m5.at(-1)!, {
    open: 70.6 + offset,
    close: 71.6 + offset,
    high: 71.8 + offset,
    low: 70.4 + offset,
  });
  if (!buy)
    for (const b of [...bars, ...m5])
      Object.assign(b, {
        open: 300 - b.open,
        close: 300 - b.close,
        high: 300 - b.low,
        low: 300 - b.high,
      });
  raw.series[1].candles = bars;
  raw.series[0].candles = m5;
  raw.quote.bid = buy ? 70.6 + offset : 300 - 70.7 - offset;
  raw.quote.ask = raw.quote.bid + 0.1;
  raw.ask_m5 = m5.map((b) => ({
    ...b,
    open: b.open + 0.1,
    high: b.high + 0.1,
    low: b.low + 0.1,
    close: b.close + 0.1,
  }));
  return raw;
}
