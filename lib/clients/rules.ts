import { z } from "zod";
export const applicationSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    client_id: z.string().trim().min(1).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,25}$/),
    mt5_login: z.string().regex(/^[1-9][0-9]{3,19}$/),
    server: z
      .string()
      .trim()
      .regex(/^Vestrado[A-Za-z0-9 ._-]{0,90}$/i),
    investor_password: z.string().min(1).max(128),
    consent: z.literal("yes"),
  })
  .strict();
export const observationSchema = z
  .object({
    application_id: z.string().uuid(),
    revision: z.string().uuid(),
    observed_at: z.string().datetime(),
    currency: z.literal("USD"),
    login: z.string(),
    server: z.string(),
    live: z.literal(true),
    read_only: z.literal(true),
    history_complete: z.literal(true),
    balance: z.number().finite(),
    equity: z.number().finite(),
    credit: z.number().finite(),
    deals: z
      .array(
        z
          .object({
            ticket: z.string().regex(/^\d+$/),
            at: z.string().datetime(),
            kind: z.enum([
              "deposit",
              "withdrawal",
              "bonus",
              "trade",
              "unknown",
            ]),
            amount: z.number().finite(),
          })
          .strict(),
      )
      .max(50000),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
export type ClientState = {
  status: string;
  approved_at: string | null;
  funded_at: string | null;
};
const DAY = 86400000;
/** Fixed rules over verified full broker history, never an LLM inference. */
export function assessAccount(
  o: Observation,
  prior: ClientState,
  now = Date.now(),
) {
  const observed = Date.parse(o.observed_at);
  if (observed > now + 5000 || observed < now - 5 * 60000)
    throw Error("Stale observation");
  const deals = [...o.deals].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) || a.ticket.localeCompare(b.ticket),
  );
  const tickets = new Set<string>();
  for (const d of deals) {
    if (tickets.has(d.ticket) || Date.parse(d.at) > observed + 5000)
      throw Error("Invalid history");
    tickets.add(d.ticket);
    if (
      (d.kind === "deposit" && d.amount <= 0) ||
      (d.kind === "withdrawal" && d.amount >= 0)
    )
      throw Error("Invalid cash transaction");
  }
  const deposits = deals
    .filter((d) => d.kind === "deposit")
    .reduce((n, d) => n + d.amount, 0);
  const withdrawals = -deals
    .filter((d) => d.kind === "withdrawal")
    .reduce((n, d) => n + d.amount, 0);
  const summary = {
    deposits,
    withdrawals,
    balance: o.balance,
    equity: o.equity,
    credit: o.credit,
  };
  if (deals.some((d) => d.kind === "unknown"))
    return {
      ...summary,
      status: prior.status,
      reason: "transaction_review",
      funded_at: prior.funded_at,
      last_trade_at: null,
    };
  let cash = 0,
    funded = prior.funded_at;
  for (const d of deals) {
    if (d.kind === "deposit" || d.kind === "withdrawal") cash += d.amount;
    if (!funded && cash >= 300 - 0.000001) funded = d.at;
  }
  if (!funded)
    return {
      ...summary,
      status: prior.status === "revoked" ? "revoked" : "pending",
      reason: "deposit_required",
      funded_at: null,
      last_trade_at: null,
    };
  const start = Date.parse(funded);
  const trades = deals.filter(
    (d) => d.kind === "trade" && Date.parse(d.at) >= start,
  );
  const firstTrade = trades[0];
  const lastTrade = trades.at(-1)?.at ?? null;
  if (prior.status === "revoked")
    return {
      ...summary,
      status: "revoked",
      reason: "revoked_requires_review",
      funded_at: funded,
      last_trade_at: lastTrade,
    };
  if (
    deals.some(
      (d) =>
        d.kind === "withdrawal" &&
        Date.parse(d.at) >= start &&
        (!firstTrade || Date.parse(d.at) <= Date.parse(firstTrade.at)),
    )
  )
    return {
      ...summary,
      status: "revoked",
      reason: "withdrawal_before_trade",
      funded_at: funded,
      last_trade_at: lastTrade,
    };
  const approved = prior.approved_at ? Date.parse(prior.approved_at) : now;
  const inactiveSince = Math.max(
    approved,
    lastTrade ? Date.parse(lastTrade) : approved,
  );
  const loss = trades.reduce((n, d) => n + d.amount, 0);
  // Exclude credit and withdrawal-driven exhaustion from the loss grace period.
  const exhaustedByLoss =
    Boolean(firstTrade) &&
    o.balance <= 0.01 &&
    loss < 0 &&
    deposits - withdrawals > 0;
  const days = exhaustedByLoss ? 31 : 7;
  const status = now - inactiveSince >= days * DAY ? "revoked" : "approved";
  return {
    ...summary,
    status,
    reason:
      status === "revoked"
        ? exhaustedByLoss
          ? "loss_inactive_31_days"
          : "inactive_7_days"
        : "eligible",
    funded_at: funded,
    last_trade_at: lastTrade,
  };
}
