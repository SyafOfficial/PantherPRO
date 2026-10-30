# Forex Factory scraper and alert integration review

Reviewed 2026-10-30 by reading GitHub source, without running third-party code or
contacting Forex Factory. Repository functionality against the live website is
not verified.

## Selected candidate

[fizahkhalid/forex_factory_calendar_news_scraper](https://github.com/fizahkhalid/forex_factory_calendar_news_scraper)
at inspected commit `acc3aad102304724f0935ba5f116fa08aaca194d`.

- MIT licence; retain its copyright and licence when incorporating code.
- Python, Selenium/Chromium, Docker, optional Streamlit and FastAPI.
- `ff_calendar_toolkit/config.py` includes actual, forecast and previous fields.
  HTML selectors use exact class strings, so upstream page changes can break
  extraction. Support in code does not verify present-day successful extraction.
- `local_api.py` provides `/events`, `/events/upcoming` and `/alerts/preview`.
  `/events` accepts currency, impact and keyword filters, with a bounded limit.
- Alert rules support currency, impact, event keywords and minutes-before.
  The alert service records sent state per event/rule/connector to reduce repeat
  notifications. Telegram, Discord and generic webhooks are documented.
- This is self-hosted software, not a hosted official Forex Factory API.

## Fit for PantherPRO

The repository now includes the adapter in `lib/forex-factory-scraper.ts`, an
optional worker sync in `lib/calendar-sync.ts`, and a pinned private-service
package under `integrations/forex-factory/`. These are implemented locally; an
operational upstream scraper host, provider registration and live end-to-end
validation are separate deployment requirements.

Run the scraper separately from the Node web and push processes. Use USD events,
explicit UTC timestamps and display conversion to Asia/Kuala_Lumpur. Its API
returns normalized `event_time` and `event_id`; map those rather than guessing
the meaning of the human-readable date/time columns. Map red/orange/yellow/gray
impact values deliberately; keep holidays distinct. Normalize `empty`/blank
figures to null, never zero.

Recommended flow:

`Forex Factory → private scraper API → Panther calendar ingestion → existing notification outbox → push worker`

The existing Panther provider-ingestion and outbox can preserve provenance,
revisions and per-user delivery preferences. Do not wire the generic scraper
webhook into the TradingView signal-publication endpoint. Calendar alerts are
event reminders, not BUY/SELL signals. No automatic trading bias should be
derived solely from the event title or impact colour.

The bundled local API has no authentication. It also contains test endpoints
that store incoming headers and bodies. Keep it private and do not expose those
test routes or send privileged credentials to them. A production integration
needs authenticated ingestion and persistent event/alert state. Container-local
files alone do not provide durable state across replacement deployments.

No service was deployed, no new paid instance created, no notifications sent,
and no provider permission record changed as part of this review. The existing
weekly JSON adapter is separate from this proposed scraper integration.

## Alternative for a Node-only implementation

[viandwi24/forexfactory](https://github.com/viandwi24/forexfactory)
documents an MIT-licensed TypeScript client with calendar events, actual,
forecast, previous, timestamps and event details. It fits the current Node stack
more closely, but does not provide the selected project's complete scheduled
alert service. Its live extraction was not tested either.

Both repositories describe unofficial extraction. Their code licences do not
grant rights to Forex Factory's underlying calendar data; verify the applicable
source terms for the intended in-app distribution.
