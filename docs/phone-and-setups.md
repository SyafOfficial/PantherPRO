# Phone app, signal notifications and method focus

The project owner wants a phone web app that notifies members when a reviewed signal arrives, with no daily signal quota. The setup focus is QM, BOS, CHOCH and trendlines, on M30, H1, H4, D1 and W1. This implementation adds the install guide, method tags/filters and event-aware signal notifications. It does not yet have a public HTTPS deployment or a verified physical-device delivery.

## Install on a phone

Deploy the Next.js application on a chosen HTTPS host and open `/install`. The app includes a manifest with stable app ID, standalone display, icons, scope and shortcuts. The guide uses the browser's native install prompt when supplied; otherwise it gives platform-specific browser menu instructions. No installation is claimed merely because the page renders.

For iPhone/iPad, use Safari → Share → Add to Home Screen, enable Open as Web App if available, then open the saved icon. Web Push requires a supported Home Screen web app, including iOS/iPadOS 16.4 or later. On Android, use the supported browser's Install app or Add to Home screen option. No store submission is configured or needed for this PWA path.

## Signal notifications

Live operation requires all database migrations, Supabase project/Auth configuration, a shared VAPID key pair, an HTTPS app and the separate persistent push worker. Follow `docs/integrations.md`; keep private keys and the service-role key server-side. Configure public values before the Next.js build.

Members sign in, open `/account`, enable New signals & modifications, enable the device and explicitly grant permission. A personal test can be queued from that page. The `/install` guide reports browser API availability separately from service configuration; neither proves OS display.

Administrator publication creates a `signal.active` outbox event in the same database transaction. The worker fans out to eligible opted-in devices, uses unique event/device deliveries, checks current membership/preferences and retries transient failures. The service worker displays **New signal · Panther FX** using fixed generic copy and opens the signal link. Signal prices, method details and premium reasoning are not exposed on the lock screen. Repeated deliveries use stable IDs/tags and browser deduplication; exactly-once delivery is not guaranteed.

A pending TradingView alert is not yet a published signal. It requires review before members are notified. There is no business rule imposing a daily signal minimum/maximum; short-term authentication/rate/queue limits remain as reliability and abuse controls. Device/browser power settings, connectivity and delivery services can delay or suppress notifications.

Before real member use, publish a reviewed staging signal, background the installed phone app, observe an actual OS notification, follow its link, and check source publication/access and delivery records. Test retries, duplicate suppression, permission revocation, VIP revocation and another device. Current automated tests simulate push in Chromium; a real device test is still outstanding.

## Strategy tags and higher-timeframe context

Apply `202610290006_signal_methods.sql` after migrations 001–005. New admin forms require a method and setup timeframe. Optional higher context must be strictly higher than the setup, within the supported M30–W1 list. A W1 setup therefore has no higher context in this scope. Client filters and detail cards show these tags.

TradingView JSON may include `strategy` (`QM`, `BOS`, `CHOCH`, `TRENDLINE`), `timeframe` (`M30`, `H1`, `H4`, `D1`, `W1`) and nullable `higher_timeframe` from the same list. Strategy and setup timeframe must be supplied together. Metadata participates in duplicate/conflict detection and is retained by ingestion. Published method tags are immutable and changes before publication are audited. Legacy alerts without tags remain compatible and explicitly unclassified; no method is inferred for old records.

These labels are not an automated pattern detector. QMTR is retired. The remaining method labels do not by themselves define an automated detector. Confirm swing confirmation, wick versus close breaks, retest criteria, trendline anchors, multi-timeframe alignment, invalidation, risk and approval rules before implementing deterministic detection. Never invent those rules or label a language-model opinion as a validated setup.

## XAUUSD news context

The calendar contains a static educational playbook for Fed rate decisions, FOMC communications, NFP, CPI, PPI and headline activity PMI. It does not seed dates, rates, forecasts or actual figures. Licensed calendar rows add source-specific context and Malaysia-time timestamps.

Fed post-news distinguishes the decision versus previous (cut/hike/hold) from the surprise versus consensus. Percent scalars and percent target ranges are supported only when actual/forecast conventions match. Range bounds are preserved and compared in basis points; no midpoint or missing bound is invented. A narrower/wider band is labeled a range adjustment rather than automatically a hike or cut.

FOMC pre-news scenarios describe hypothetical hawkish/balanced/dovish guidance without a numeric forecast requirement. Post-news tone remains insufficient without verified statement/minutes/press-conference text and expectations. Calendar presence alone does not reveal tone or policy probabilities.

NFP context distinguishes payrolls from unemployment, wages and revisions. CPI and PPI keep headline/core and monthly/annual distinctions and do not calculate one index from another. PMI comparisons separate actual-versus-forecast surprise from the 50 headline activity threshold; prices/employment/new-orders subindices are not treated as headline PMI.

The signal desk's news watch examines all supplied events for the six watched families (and other source-rated high-importance releases) within the next hour and 15 minutes after a release. Within ±15 minutes it highlights spread/slippage/reversal risk. Missing data is unavailable, never a claim of no news. It flags old source timestamps and never automatically publishes or executes a trade. Existing provider-rated high-impact news queue preferences remain unchanged; educational category labels do not override source importance or fabricate notifications.
