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

- Full, reconciled live USD Vestrado account history is required. Admission
  requires at least USD300 of existing real balance, excluding credits/bonuses
  and unrealised gains. Existing realised trading profits can form part of this
  capital; a fresh USD300 deposit is not required. Cash/trade ledger reconciliation
  also excludes balance-type bonuses. Historical deposits alone do not qualify
  an account whose current real balance is below USD300. Unknown transactions
  suppress new approvals pending review.
- Monitoring starts at app approval. Historical withdrawals/trades before approval
  do not trigger retrospective revocation. Withdrawal before (or simultaneous with)
  the first filled trade after approval revokes access. Subsequent withdrawals
  alone do not revoke access. Trading losses below USD300 do not revoke access.
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

In **setup mode** (`client_access_policy.enforced=false`), only team accounts
created before onboarding originally launched retain the temporary access exception.
The frozen `setup_started_at` cutoff is copied from the initial policy timestamp;
returning to setup mode never moves it forward. New registrations, including those
made before this fix but after onboarding launched, must complete the form and remain
Pending until verified and approved. A revoked application always removes non-admin
access, including during setup. Existing team members are required to qualify when
full enforcement is enabled.

Database RLS, RPCs, terminal routing, service-backed APIs and push delivery use the
same eligibility helper. An open terminal rechecks access each minute and on tab
return. Admins remain exempt. A dedicated Windows observer and real broker mapping
require a successful real observer run; setup mode does not mean broker monitoring is live. The admin
can enable full enforcement only after a live client has been verified approved
within the last 10 minutes.

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
3. Download the reviewed launcher from the MFA administrator directory. Bank labels
   in the supplied mapping were checked against operator-provided Vestrado history;
   unrecognised labels/transfers remain subject to review.
4. Follow the single-pass command under **Automatic observer deployment** below.
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

## Automatic observer deployment (reviewed mapping)

The admin directory provides a **Download VPS observer launcher** link. The route
requires live admin identity plus MFA and returns a launcher with the exact reviewed
Python program and mapping encoded inside it. It contains no credentials, database
keys or monitor secret. Only this separate terminal may receive client logins:
`C:\Panther-Client-Monitor\terminal64.exe` in portable mode. The observer verifies
both installation and data directories before calling `mt5.login`. It takes a
Windows file lock so two observers cannot switch accounts in the same terminal.

The observed SDK constants are used directly (Balance=2, Credit=3, Correction=5,
Bonus=6), not hardcoded numeric guesses. Reviewed bank labels are D DGPay v2,
D Online Banking VTP (FPX), W DGPay v2 and W IT-Payment Gateway (AWP), with exact
patterns in `monitoring/vestrado-mapping.json`. Other transfers are unknown unless
an operator has reviewed their source. Per-account reviewed bonus comments live
in the private application record, not in the repository or launcher. Credit,
bonus and reviewed bonus transfers cannot contribute to admission capital.
Negative-balance protection can erase a deficit, never create positive eligible
capital. Raw broker history separately reconciles balance and credit, including
balance-type bonuses/corrections in the raw balance total.

A manually admitted account retains its manual-override label. It never becomes a
verified-deposit claim just because a subsequent account check succeeds. The
existing trading/inactivity rules still apply when history is sufficient.

Use the SDK versions already verified on the operator VPS (requirements.txt).
After downloading the launcher in the VPS browser, run one pass:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\Start-PantherClientMonitor.ps1" -Once
```

At the hidden prompt, enter **CLIENT_MONITOR_SECRET** from the web service's Render
Environment page, not MT5_BRIDGE_SECRET. Never put the secret in chat, a screenshot,
a script or a command argument. Inspect the results in `/admin/clients`. Once real
checks are accepted, rerun the same command without `-Once` and keep that observer
window running on the VPS. This is a separate process from the price uploader.

The observer checks due accounts in bounded pages, serially. A cursor advances even
past failed account logins so one bad credential cannot starve later pages. Unknown
sources stay Pending for review; authentication/network failures do not invent
balances or trades. Existing approved decisions survive outages and last-check
staleness remains visible to the operator. Larger client populations may require
multiple independent observer terminals or a broker API for suitable check latency.

Automatic status transitions atomically append an access event and queue an
administrator-only push in the existing outbox. Repeat checks do not queue a second
approval push. The device must have push enabled and an active subscription. Push
service acceptance is not guaranteed display. A successful real account check is
required before describing the Windows observer as live; website deployment alone
is insufficient.

Clients can correct an investor password under **Update investor connection** on
`/onboarding`. Passwords remain encrypted. The action binds the owner to the signed
identity and uses revision matching. It does not change account number, consent,
approval status, original approval timestamp or activity clocks. Revoked accounts
cannot restore themselves through a password update. Approved server changes need
administrator review. New registrations select the observed Vestrado-Server name.
