# Private Forex Factory scraper service

This packages the reviewed MIT-licensed upstream commit in a separate container.
Its upstream copyright/licence remain in `/opt/forex-factory/LICENSE`. No image
has been built or live scraper run verified in this workspace.

From this directory, build with `docker build -t panther-ff-scraper .`.
For local evaluation:

```sh
docker run --rm --name panther-ff-scraper \
  -p 127.0.0.1:8765:8765 \
  -v panther-ff-data:/data panther-ff-scraper
```

The source is scraped hourly. The API can briefly be unavailable while the
upstream writes its files; Panther treats those responses as unavailable. Data
keeps its original `scraped_at`, and Panther rejects data older than 24 hours.
The API exposes only `/health` and read-only `/events`, omitting upstream webhook
test endpoints. It has no public authentication: keep it on a private network,
or place an authenticated TLS proxy in front of it. Persist `/data`.

On Panther's web service and push worker, set `FF_SCRAPER_API_URL` to the reachable
private API origin, for example `http://panther-calendar.internal:8765`. A local
loopback address only works for a process on the same machine/container.
`FF_SCRAPER_AUTH_TOKEN` is optional and only applies when the operator's reverse
proxy enforces it. The adapter refuses redirects.

For database import and alerts, the push worker additionally needs
`FF_CALENDAR_PROVIDER_ID`, referencing an existing enabled calendar provider.
Provider display/analysis permission flags are not automatically created or
enabled by this integration. Its licence reference must describe the actual
source permission, not merely the MIT licence of this scraper's code.

The worker fetches the private API every five minutes and uses existing database
ingestion/revision checks. Existing outbox rules queue high-impact reminders
within 30 minutes and supplied actual-release notifications. Holiday rows are
displayed but not ingested as economic-release alerts. Source failures do not
stop signal push delivery. Broker signal-publication rules are unchanged.

No API URL, provider ID, extra paid service or cloud-environment policy is changed
by these files. Live setup still needs a reachable scraper host and source-access
validation before alerts can be claimed operational.
