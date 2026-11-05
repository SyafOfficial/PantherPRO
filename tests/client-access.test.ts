import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessAccount,
  observationSchema,
  type Observation,
} from "../lib/clients/rules";
import {
  encryptCredential,
  decryptCredential,
  monitorAuthorized,
} from "../lib/clients/crypto";
const now = Date.parse("2026-11-05T12:00:00Z"),
  day = 86400000;
const at = (n: number) => new Date(now - n * day).toISOString();
const base: Observation = {
  application_id: "00000000-0000-4000-8000-000000000002",
  revision: "00000000-0000-4000-8000-000000000003",
  observed_at: at(0),
  currency: "USD",
  login: "12345",
  server: "Vestrado-Live",
  live: true,
  read_only: true,
  history_complete: true,
  balance: 300,
  equity: 300,
  credit: 0,
  deals: [{ ticket: "1", at: at(10), kind: "deposit", amount: 300 }],
};
const pending = { status: "pending", approved_at: null, funded_at: null };
const trade = (days: number, amount = -1) => ({
  ticket: "2",
  at: at(days),
  kind: "trade" as const,
  amount,
});
test("only real funding qualifies; bonus, unknown records and stale history cannot approve", () => {
  assert.equal(assessAccount(base, pending, now).status, "approved");
  assert.equal(
    assessAccount(
      { ...base, deals: [{ ...base.deals[0], kind: "bonus" }] },
      pending,
      now,
    ).status,
    "pending",
  );
  assert.equal(
    assessAccount(
      { ...base, deals: [{ ...base.deals[0], amount: 299.99 }] },
      pending,
      now,
    ).status,
    "pending",
  );
  assert.equal(
    assessAccount(
      {
        ...base,
        deals: [
          ...base.deals,
          { ticket: "9", at: at(1), kind: "unknown", amount: 300 },
        ],
      },
      pending,
      now,
    ).reason,
    "transaction_review",
  );
  assert.throws(
    () => assessAccount({ ...base, observed_at: at(1) }, pending, now),
    /Stale/,
  );
  assert.equal(
    observationSchema.safeParse({ ...base, history_complete: false }).success,
    false,
  );
  assert.equal(
    observationSchema.safeParse({ ...base, read_only: false }).success,
    false,
  );
});
test("withdrawal before first trade revokes; later withdrawals and ordinary trading losses alone do not", () => {
  const approved = {
    status: "approved",
    approved_at: at(10),
    funded_at: at(10),
  };
  const w = { ticket: "3", at: at(2), kind: "withdrawal" as const, amount: -1 };
  assert.equal(
    assessAccount({ ...base, deals: [...base.deals, w] }, approved, now).reason,
    "withdrawal_before_trade",
  );
  assert.equal(
    assessAccount(
      { ...base, deals: [...base.deals, trade(1), w] },
      approved,
      now,
    ).status,
    "revoked",
  );
  assert.equal(
    assessAccount(
      { ...base, deals: [...base.deals, trade(3), w] },
      approved,
      now,
    ).status,
    "approved",
  );
  assert.equal(
    assessAccount(
      {
        ...base,
        balance: 100,
        equity: 100,
        deals: [...base.deals, trade(1, -200)],
      },
      approved,
      now,
    ).status,
    "approved",
  );
});
test("seven-day inactivity has exact boundary; loss-exhausted accounts get 31 days and revocation stays sticky", () => {
  const prior = { status: "approved", approved_at: at(40), funded_at: at(40) };
  assert.equal(
    assessAccount({ ...base, deals: [...base.deals, trade(7)] }, prior, now)
      .reason,
    "inactive_7_days",
  );
  assert.equal(
    assessAccount({ ...base, deals: [...base.deals, trade(6.999)] }, prior, now)
      .status,
    "approved",
  );
  const exhausted = {
    ...base,
    balance: 0,
    equity: 0,
    deals: [{ ...base.deals[0], at: at(40) }, trade(30, -300)],
  };
  assert.equal(assessAccount(exhausted, prior, now).status, "approved");
  assert.equal(
    assessAccount(
      { ...exhausted, deals: [exhausted.deals[0], trade(31, -300)] },
      prior,
      now,
    ).reason,
    "loss_inactive_31_days",
  );
  assert.equal(
    assessAccount(base, { ...prior, status: "revoked" }, now).status,
    "revoked",
  );
});
test("existing real capital qualifies without a new deposit; old exhausted balances and bonus/floating funds do not", () => {
  const historical = {
    ...base,
    balance: 300,
    equity: 300,
    deals: [
      { ...base.deals[0], at: at(365), amount: 500 },
      { ticket: "3", at: at(30), kind: "withdrawal" as const, amount: -200 },
    ],
  };
  const existing = assessAccount(historical, pending, now);
  assert.equal(existing.status, "approved");
  assert.equal(existing.funded_at, base.observed_at);
  const profits = {
    ...base,
    deals: [{ ...base.deals[0], amount: 100 }, trade(30, 200)],
  };
  assert.equal(assessAccount(profits, pending, now).status, "approved");
  assert.equal(
    assessAccount(
      {
        ...base,
        balance: 0,
        equity: 0,
        deals: [...base.deals, trade(1, -300)],
      },
      pending,
      now,
    ).status,
    "pending",
  );
  assert.equal(
    assessAccount(
      {
        ...base,
        deals: [
          { ...base.deals[0], amount: 100 },
          { ticket: "4", at: at(1), kind: "bonus", amount: 200 },
        ],
      },
      pending,
      now,
    ).status,
    "pending",
  );
  assert.equal(
    assessAccount(
      {
        ...base,
        balance: 200,
        equity: 400,
        deals: [{ ...base.deals[0], amount: 200 }],
      },
      pending,
      now,
    ).status,
    "pending",
  );
  assert.equal(
    assessAccount({ ...base, credit: 500 }, pending, now).status,
    "approved",
  );
});
test("credentials are authenticated, owner-bound and monitor authorization is independent", () => {
  process.env.CLIENT_CREDENTIAL_KEY = "a".repeat(64);
  process.env.CLIENT_MONITOR_SECRET = "b".repeat(64);
  const encrypted = encryptCredential(
    "test-investor-only",
    base.application_id,
  );
  assert.ok(!encrypted.includes("test-investor-only"));
  assert.equal(
    decryptCredential(encrypted, base.application_id),
    "test-investor-only",
  );
  assert.throws(() => decryptCredential(encrypted, "other-owner"));
  assert.throws(() =>
    decryptCredential(encrypted.slice(0, -4) + "AAAA", base.application_id),
  );
  assert.equal(monitorAuthorized(new Request("https://example.com")), false);
  assert.equal(
    monitorAuthorized(
      new Request("https://example.com", {
        headers: { authorization: "Bearer " + "b".repeat(64) },
      }),
    ),
    true,
  );
});

test("negative-balance adjustments cannot fabricate capital and manual admission stays labelled", () => {
  const bonus = {
    ...base,
    balance: 300,
    deals: [{ ...base.deals[0], kind: "bonus" as const }],
  };
  assert.equal(assessAccount(bonus, pending, now).status, "pending");
  assert.equal(
    assessAccount(
      { ...base, deals: [{ ...base.deals[0], kind: "adjustment" }] },
      pending,
      now,
    ).status,
    "pending",
  );
  const recovered = {
    ...base,
    deals: [
      { ticket: "9", at: at(40), kind: "trade" as const, amount: -100 },
      { ticket: "10", at: at(39), kind: "adjustment" as const, amount: 100 },
      ...base.deals,
    ],
  };
  assert.equal(assessAccount(recovered, pending, now).status, "approved");
  assert.equal(
    assessAccount(
      bonus,
      {
        status: "approved",
        approved_at: at(1),
        funded_at: null,
        reason: "manual_owner_override_bonus_funds_acknowledged",
      },
      now,
    ).reason,
    "manual_owner_override_bonus_funds_acknowledged",
  );
});
