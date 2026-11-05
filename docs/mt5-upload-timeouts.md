# MT5 Upload Timeout Investigation

The VPS uploader reports WebException / NetworkStatus Timeout at Invoke-RestMethod, whose deadline is 25 seconds. Read-only VPS checks showed a current JSON snapshot (three seconds old in the latest supplied check), XAUUSD.V, execution_enabled=false and HTTP 200 from /api/health. These do not prove that a signed upload reaches storage.

The dedicated /api/bridge/mt5 endpoint authenticates each body with a timestamp-bound HMAC, validates schema and quote freshness, and uses the service role for atomic ingestion. It does not use browser cookies. Exclude only this route (and its trailing-slash form) from the browser-session proxy to avoid an unnecessary session/body-proxy path. Account/admin and similarly prefixed routes remain matched. HMAC, byte limits, snapshot freshness and database checks are unchanged.

Add request-stage timing diagnostics for slow/error uploads: fixed stage labels, response status and elapsed milliseconds only. No credentials, signatures, headers, snapshots or exception bodies are logged. The eight-second diagnostic timer reports slowness but does not abort an upload. Neither the uploader's 25-second timeout nor quote freshness limits are increased.

The exact timeout cause remains unconfirmed. Successful receipt of a fresh VPS snapshot is required before reporting the feed restored. If the issue persists, stage logs distinguish body reading, validation and storage delays from failures before the handler. No synthetic production market snapshots are sent.
