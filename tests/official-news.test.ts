import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFICIAL_FEEDS,
  parseOfficialFeed,
  officialNews,
} from "../lib/official-news";
const now = Date.parse("2026-10-30T15:45:00Z");
const item = (
  url = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261030a.htm",
  date = "Fri, 30 Oct 2026 14:00:00 GMT",
) =>
  `<rss version="2.0"><channel><item><title><![CDATA[Policy &amp; rates]]></title><link>${url}</link><pubDate>${date}</pubDate></item></channel></rss>`;
test("official RSS preserves attribution and actual publication date without fabricated figures", () => {
  const headlines = parseOfficialFeed(item(), OFFICIAL_FEEDS[0], now);
  assert.equal(headlines.length, 1);
  assert.equal(headlines[0].title, "Policy & rates");
  assert.equal(headlines[0].source, "Federal Reserve");
  assert.equal(headlines[0].published_at, "2026-10-30T14:00:00.000Z");
  assert.equal("forecast" in headlines[0], false);
});
test("RSS rejects entities and excludes hostile URLs, credentials and future headlines", () => {
  assert.throws(() =>
    parseOfficialFeed(
      '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + item(),
      OFFICIAL_FEEDS[0],
      now,
    ),
  );
  for (const url of [
    "javascript:alert(1)",
    "https://untrusted.example/",
    "https://www.federalreserve.gov.untrusted.example/",
    "https://user:pass@www.federalreserve.gov/",
  ])
    assert.equal(
      parseOfficialFeed(item(url), OFFICIAL_FEEDS[0], now).length,
      0,
    );
  assert.equal(
    parseOfficialFeed(
      item(undefined, "Sat, 31 Oct 2026 14:00:00 GMT"),
      OFFICIAL_FEEDS[0],
      now,
    ).length,
    0,
  );
  assert.throws(() =>
    parseOfficialFeed("<html>not RSS</html>", OFFICIAL_FEEDS[0], now),
  );
});
test("feed failures remain unavailable while successful official source data is displayed", async () => {
  const fetcher: typeof fetch = async (input) =>
    String(input) === OFFICIAL_FEEDS[0].url
      ? new Response(item(), { status: 200 })
      : new Response("Unavailable", { status: 503 });
  const result = await officialNews(fetcher, now);
  assert.equal(result.headlines.length, 1);
  assert.equal(result.sources[0].status, "available");
  assert.ok(result.sources.slice(1).every((s) => s.status === "unavailable"));
  assert.equal(result.economic_calendar, "not_connected");
});
