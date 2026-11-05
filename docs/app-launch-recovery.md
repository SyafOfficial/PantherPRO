# Installed App Launch Recovery

Observed: the reported white page occurs from the iPhone Home Screen app. Render confirms that the web service is on the Free plan. No new runtime error appeared in the queried interval after the previous deployment; latency metrics were unavailable. The exact device failure was not reproduced, so cold starts, restored documents and version-skew are possible contributors, not a confirmed device diagnosis.

Changes:

- Render commit SHA supplies Next deploymentId, allowing client navigation to detect deployment mismatch and request a full document.
- Root document and global error boundary use an explicit dark background. Root errors have a reload link requiring no event handler.
- Launch hold/fade totals 0.8 seconds instead of 1.8. CSS reveals content even when JavaScript is unavailable.
- A genuine route wait exposes Reload Workspace after eight seconds.
- Installed service-worker navigation fetches live documents without caching them. Network errors, HTTP 5xx and a twelve-second response deadline produce a standalone dark Retry screen. API calls and push handling are unaffected. Retry preserves the same-origin path/query using HTML escaping, and the response is no-store with no scripts.
- Identity lookup is memoized only within a React server render; intelligence and signal requests run concurrently after authentication. Public icons and manifest no longer incur a session refresh; the health endpoint skips authentication while retaining CSP.

The fixes do not eliminate Free-plan server cold starts, cache private data, change authorization, or alter signal rules. A first launch before an existing service worker has updated can still use its previous behavior. After rollout, fully close and reopen the installed app; opening the normal app URL can also obtain the update. Do not clear all site storage as a first step because that can disrupt login and push registration.

Validation includes service-worker live/error/deadline paths, unchanged push text, phone navigation, and CSS visibility with JavaScript disabled. CI runs the full unit/database, build and browser suites.
