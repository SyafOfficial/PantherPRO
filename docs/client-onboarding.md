# Client onboarding and access

Client registration is `/onboarding`; MFA administrator directory and durable alerts
are `/admin/clients`. One broker server/account can belong to only one app user.
App email comes from the authenticated identity, not a submitted form field.
Clients consent explicitly to read-only monitoring and administrator credential access.

Investor credentials are AES-256-GCM encrypted with owner-bound AAD. The separate
`CLIENT_CREDENTIAL_KEY` is a 32-byte hex server secret, never a public variable.
Back it up securely; changing it without re-encrypting stored records makes old
credentials unreadable. Ordinary browser roles cannot read even ciphertext.
Password reveals require the current administrator profile and signed MFA level,
same-origin POST, no-store responses and a durable audit before disclosure. The
browser clears the revealed password after 30 seconds or on leaving the tab.

## Rules

- Full, reconciled live USD Vestrado account history is required. Credits/bonuses
  do not contribute to the USD300 threshold; unknown transaction types suppress
  new approvals pending review. The threshold is cumulative cash deposits less
  withdrawals, not equity, profits or a screenshot.
- Withdrawal after funding and before (or simultaneous with) the first real filled
  trade revokes access. Subsequent withdrawals alone do not revoke access under
  the owner's current rule. Trading losses below USD300 do not revoke access.
- Inactivity is seven elapsed days since approval or the latest filled trade,
  whichever is later. An account at zero balance with trading losses and positive
  net cash funding has 31 elapsed days instead. This replaces the earlier request
  to keep balance above USD300 for seven days.
- The observer's verified timestamp drives checks, not browser time. Stale,
  incomplete, mismatched and superseded observations cannot change access.
  Revocation is sticky: later observations cannot automatically restore it.
- Revocation removes future authorised reads and push eligibility. It cannot
  retract already delivered notifications, screenshots or prevent account sharing.

## Deployment boundary

The schema starts in **setup mode** (`client_access_policy.enforced=false`). Existing
member access is unchanged while a dedicated Windows observer is installed and
real broker transaction classification is validated. Never claim automated
monitoring is live just because the website is deployed. The admin can enforce
onboarding only after a client has a verified approved check in the last 10 minutes.
Once enabled, database RLS, RPCs, terminal routing, service-backed market/news APIs
and push delivery all enforce the recorded access decision. An open terminal rechecks
access each minute and on returning to the tab, routing revoked clients to onboarding.
Admins remain exempt.

Set `CLIENT_CREDENTIAL_KEY` and independent `CLIENT_MONITOR_SECRET` on the web
service. The observer receives only the monitor secret, not the database service
role or credential encryption key. POST `/api/bridge/clients` uses that scoped
bearer secret over HTTPS, outside the browser session proxy. Polling returns
credentials only to this trusted operator process. Never save passwords in scripts,
logs, command arguments or the transaction mapping file.

## Windows setup (operator action required)

1. Keep the current signal-feed MT5 and Panther Bridge untouched. Install a separate
   Vestrado MT5 copy under `C:\Panther-Client-Monitor`, for serial read-only account checks.
2. Install Python 3.11+ (64-bit) and the official `MetaTrader5` Python package in a
   virtual environment. Do not enable trading or install an execution EA.
3. Copy `monitoring/vestrado_clients.py` and the mapping example to the VPS. Validate
   actual Vestrado deposit, withdrawal and bonus transaction comments/types on a
   controlled account, set exact per-server regexes, then set `broker_validated=true`.
   No real broker mapping has yet been supplied or validated in this repository.
4. Run from the activated environment:
   `python vestrado_clients.py --terminal C:\Panther-Client-Monitor\terminal64.exe --mapping vestrado-mapping.json --once`
   Enter the monitor secret at the hidden prompt, retrieved privately from Render.
5. Verify the controlled account in the admin directory. Check a real deposit,
   excluded bonus, actual filled trade and withdrawal before enforcing onboarding.
6. Run without `--once` in a persistent VPS session. Checks target a five-minute
   cadence, with one account at a time. At larger volume use broker API/pool of
   separate terminals; this first observer cannot guarantee instant detection.

Monitor outages preserve prior decisions instead of inventing trades/withdrawals.
The directory displays last verification timestamps and marks checks stale after
10 minutes. Approval/revocation creates durable admin events and opt-in admin push
notifications via the existing delivery queue. Push acceptance does not guarantee
notification display. Recovery/re-approval is intentionally operator-controlled;
there is no client-side resubmit loophole to reset an inactivity clock.
