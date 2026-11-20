# Confirmed BOS/CHOCH setups waiting for entry

Owner authorized this flow on 19 November 2026. The `base-waiting-v1` capability separates the completed setup/M5 confirmation from the later observed entry. It applies only to BOS/CHOCH. All other strategies retain their current entry and SL rules.

A fresh, validated origin-base rejection outside the base can publish a **WAITING FOR ENTRY** setup. Its entry price is explicitly indicative (BUY: upper base edge; SELL: lower edge). SL is the locked original base wick; TP1–TP3 must match the existing nearest intact structural levels. The existing eight-price-unit zone limit remains. A quote already beyond TP1 cannot publish a waiting setup.

The service-owned wait record locks the original plan and original confirmation. Each fresh snapshot checks the same higher context, intact targets, setup expiry, completed exit-side M5 invalidation and feed continuity. Expiry follows the existing twelve-subsequent-setup-bar lookback; monthly expiry uses calendar months. A monitoring gap over 90 seconds cancels the wait rather than assuming an entry occurred. Targets passed before entry cancel the wait. Cancellation is explicitly **no entry**, with no performance ledger, TP/SL/BE observations or tracking row.

A later current broker quote inside the original base activates the existing signal ID. BUY uses ask; SELL uses bid and requires fresh actual ask-side M5 evidence. The observed entry replaces only the indicative entry. The base, SL and targets remain locked. Monitoring starts at activation's current tick and latest exit-side completed M5; pre-entry candles cannot become trade results. The signal's activation time is used for performance. A duplicate scan cannot publish another waiting or active event for the same setup.

App notifications distinguish waiting, active and cancelled-before-entry messages. Pending published rows are visible in the existing client signal list and retain existing account access and notification preferences. No production signal or result is fabricated during rollout.

## Rollout

1. Apply the additive migration with `base_entry_mode` left NULL. The previous active engine remains behind a compatible RPC wrapper; new publication behavior remains off.
2. Deploy the compatible web and worker commits and verify live status.
3. Enable `automatic_engine_policy.base_entry_mode='base-waiting-v1'` and audit the owner authorization.
4. Observe subsequent real completed confirmations. Enabling the capability does not backfill old confirmations or guarantee a signal every day.

Telegram forwards waiting setups as the root message, activation as a reply, and cancellation-before-entry without claiming a trade result. Deploy the compatible receiver first, then apply the Telegram waiting-event migration. Existing active-only signals retain their original entry root and management replies. Pausing the waiting capability cancels outstanding waits without affecting existing active signal tracking.
