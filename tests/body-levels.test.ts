import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyOriginLevels } from "../lib/body-levels";
function bars(closes: number[]) {
  return closes.map((close, i) => ({
    opened_at_server_raw: 10000 + i * 3600,
    open: i ? closes[i - 1] : close + 0.1,
    close,
    high: Math.max(close, i ? closes[i - 1] : close + 0.1) + 5,
    low: Math.min(close, i ? closes[i - 1] : close + 0.1) - 5,
  }));
}
test("support uses the closing origin of a confirmed body rally, never its wick", () => {
  const data = bars([105, 104, 100, 102, 106]);
  const found = bodyOriginLevels(data, 108).support!;
  assert.equal(found.price, 100);
  assert.equal(found.originOpenedAt, data[2].opened_at_server_raw);
  assert.equal(found.confirmedOpenedAt, data[4].opened_at_server_raw);
  const changed = data.map((b) => ({
    ...b,
    high: b.high + 100,
    low: b.low - 50,
  }));
  assert.deepEqual(bodyOriginLevels(changed, 108), bodyOriginLevels(data, 108));
  assert.equal(bodyOriginLevels(data.slice(0, 4), 108).support, null);
});
test("resistance mirrors closing body origin and ignores wick extremes", () => {
  const data = bars([95, 96, 100, 98, 94]);
  assert.equal(bodyOriginLevels(data, 92).resistance!.price, 100);
  assert.equal(bodyOriginLevels(data, 92).resistance!.departure, 6);
});
test("close breaks invalidate origins while wick penetrations do not", () => {
  const data = bars([105, 104, 100, 102, 106]);
  assert.equal(
    bodyOriginLevels(
      [
        ...data,
        ...bars([103]).map((b) => ({
          ...b,
          opened_at_server_raw: 30000,
          low: 90,
        })),
      ],
      108,
    ).support!.price,
    100,
  );
  assert.equal(
    bodyOriginLevels(bars([105, 104, 100, 102, 106, 99]), 108).support,
    null,
  );
  assert.equal(
    bodyOriginLevels(bars([95, 96, 100, 98, 94, 101]), 92).resistance,
    null,
  );
});
test("a nearer small close pivot cannot replace an origin without displacement and break", () => {
  const data = bars([105, 104, 100, 102, 106, 107, 106, 105, 106, 107]);
  assert.equal(bodyOriginLevels(data, 108).support!.price, 100);
  assert.equal(
    bodyOriginLevels(bars([100, 100, 100, 100, 100]), 105).support,
    null,
  );
});
