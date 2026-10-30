# Market context

The connected Market Analysis view derives structure, EMA20/50, Wilder RSI14,
Wilder ATR14 and confirmed-pivot support/resistance from the selected MT5
timeframe. It uses up to 100 completed broker candles and requires at least 50.
Indicator warm-up uses that window, so readings can differ from a broker chart
using longer history. These readings provide context, not a separate entry signal.
Quotes refresh from the existing sampled MT5 bridge; stale data is labelled.

The authenticated `/api/context/news` endpoint fetches fixed Federal Reserve and
BLS RSS sources with a 60-second cache. The UI shows original publication dates,
source links and individual feed availability. These are released headlines,
not a streaming news service, economic calendar, forecast/actual comparison or
PMI feed. Failed sources do not produce substitute headlines or trading bias.

The Economic Calendar view separately uses the Forex Factory weekly JSON export
at `https://nfs.faireconomy.media/ff_calendar_thisweek.json`. The authenticated
`/api/context/calendar` endpoint caches responses and failures for one hour per
server process. It shows USD events in Malaysia time, preserves source forecast
and previous values, and leaves actual values unavailable unless explicitly
supplied. It does not scrape HTML, infer release results, or feed automatic
publication/notification rules. It is not a real-time release-results service.
This upstream URL and its availability also require live verification. Source
attribution does not establish a redistribution licence.

The fixed RSS URLs still require live availability checks in the deployment
environment. Local tests use controlled fixtures and simulated source failures;
they do not establish that those upstream feeds currently respond. This change
requires no database migration or new API secret.
