# Phase 4: source-backed intelligence foundation

The application now computes technical context, pre-news scenarios and post-news comparisons on the server from permission-filtered database records. The UI clearly calls this **rules-based analysis**. No language model, AI API, licensed price vendor or calendar adapter is connected. Demo chart fixtures are never used as analysis inputs.

## Setup and authorization

Apply migration `202610280005_intelligence_inputs.sql` after migrations 001–004. It adds `data_providers.analysis_allowed`, default false. A trusted operator must verify source rights before enabling this flag. Analysis also requires both `enabled` and `display_allowed`; administrator access to raw records does not bypass these gates when generating member reports. Client roles cannot change provider flags.

`get_intelligence_inputs()` requires an authenticated session. It selects at most 2,400 observations from the latest permitted quote provider within 90 minutes and up to 100 permitted US calendar events within ±24 hours. It does not merge price sources or include signals, member records, keys or license references. A dense feed may exhaust the observation bound before covering 30 minutes; the engine then correctly withholds analysis. A future production aggregation/job can address higher-frequency feeds after confirming vendor cadence and retention rights.

The root server page computes reports from those inputs. Authenticated `GET /api/intelligence` exposes the same structured bundle with private/no-store caching. It has no signal-write or trade-execution path. The API returns 401 for guests and 503 for a failed source query. A missing migration produces an analysis-specific warning rather than substitute facts.

## Technical method

Input quotes must be valid, strictly chronological, from one provider, without a gap larger than that provider's configured interval. Source and receipt timestamps are checked; stale latest quotes produce `insufficient_data`. Raw quote prices must have a valid bid/ask spread. All calculations use the permitted observed quote source, never demo data.

The engine uses the last midpoint observation in each completed UTC minute. At least 30 consecutive completed minute observations are required, up to a 60-minute calculation window. The current partial minute is excluded from calculations, but its/latest quote freshness still gates the report. These samples are not exchange OHLC candles and do not recover price paths between quotes.

Computed statistics:

- EMA(9) and EMA(21), each initialized with its window's simple mean.
- Ten-completed-minute midpoint change.
- Simple 14-change RSI (not Wilder-smoothed RSI); flat observations give 50, no losses give 100.
- Standard deviation of sampled minute log returns, expressed as a percentage, not annualized or forecast.
- Last-20-sample observed midpoint range (a proxy, not validated support/resistance or liquidity).
- Average sampled bid/ask spread and completed observation count.

Bullish context requires EMA9 above EMA21, positive momentum and RSI ≥55. Bearish context requires the reverse with RSI ≤45. EMA/momentum comparisons must exceed the larger of half the average spread and 0.001% of the latest calculation midpoint. Otherwise context is neutral. RSI extremes carry warnings; they are not reversal predictions. A high-impact release within an hour adds a risk warning without changing the technical evidence or creating a signal. Missing calendar data is explicitly labeled technical-only context.

## Fundamental modes

Pre-news requires a source-consensus forecast, a release within the next 24 hours and no actual figure. It describes above/near/below-consensus scenarios without invented values or probabilities. Post-news requires a released event from the last 24 hours plus actual and consensus in matching parseable source units. It reports `actual - forecast` and above/below/in-line comparison. This is a numerical difference, not a standardized economic surprise score.

The parser accepts explicit numbers (including correctly grouped thousands) and matching `%`, `K`, `M`, `B` or `bps` suffixes. It refuses ambiguous localized strings, missing values, narrative figures and cross-unit conversion. Unknown provider missing-value tokens must be mapped to null in the authorized adapter. Source updates older than 24 hours or inconsistent/future provenance withhold analysis. Previous figures remain null when missing.

Known US inflation/rates/activity/labor event names receive conditional rates/USD/gold context. Higher unemployment is interpreted differently from stronger payroll or inflation figures. Unknown indicators receive numerical context only. No release comparison alone produces a directional gold bias; sufficient fundamental context remains neutral. Actual USD/yield responses and positioning are not supplied by a calendar record, so they are never invented.

## Optional model explanation contract

`lib/intelligence/explanations.ts` defines a transport interface for a future selected AI provider. No vendor adapter, API call, credential, stored draft, approval UI or public model output is active. The owner has not supplied an AI API provider. Website access to a chat service is not assumed to include API credentials.

The interface only accepts fresh, sufficient rule-based analysis. It binds the response to a SHA-256 digest of that exact report, limits the response envelope, requires a known source ID for every paragraph, rejects unknown fields (including signal instructions), and rejects a response if the analysis expires during generation. Provider errors are sanitized. Source text is passed as untrusted data with explicit instructions to ignore embedded instructions and introduce no new prices, releases, probabilities, signals or profit claims.

Validation does not prove factual accuracy or solve prompt injection. Every accepted response remains `unreviewed`, is not persisted/displayed by the application and has no path to publish a signal. Connecting a real model still requires a confirmed provider/API contract, secure server-side credentials, bounded network requests, editorial review workflow, cost/rate controls, privacy review and real provider tests. Model output alone must never become a trading signal.

## Validation and remaining limits

Unit tests cover up/down/flat observations, gaps, stale/mixed/duplicated inputs, minute coverage, missing figures, numerical surprise, units, conditional event context and model-draft evidence binding/expiry. PostgreSQL tests exercise analysis permission gates independently of display rights. Browser tests exercise all three empty modes, source disclosures, mobile width and anonymous API denial.

The UI timestamps each report, exposes its input evidence and method limits, and withholds expired report metrics. It is educational context with no guarantee of market direction. Real-source acceptance, a selected AI adapter, provider-backed narrative quality tests, model review/persistence, monitoring and production deployment remain outstanding.

The expanded XAUUSD news module now covers Fed rate target ranges, FOMC qualitative scenarios, NFP, CPI, PPI and headline activity PMI, with signal-desk timing warnings and an educational playbook. See [phone, setups and news](phone-and-setups.md). FOMC pre-news can present explicitly hypothetical scenarios without a numeric consensus; post-news language classification still requires verified source text. Fed rate comparisons preserve target-range bounds and distinguish policy changes from consensus surprises. No numerical or narrative release data is invented.
