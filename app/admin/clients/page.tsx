import Link from "next/link";
import { redirect } from "next/navigation";
import { identity, supabase } from "@/lib/supabase";
import PerformanceRefresh from "@/components/performance-refresh";
import ClientPassword from "@/components/client-password";
import { setGate } from "./actions";
export const dynamic = "force-dynamic";
const money = (n: number | null) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const time = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })
    : "—";
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; message?: string }>;
}) {
  const user = await identity();
  if (user?.role !== "admin") redirect("/login");
  if (user.aal !== "aal2") redirect("/account/security");
  const params = await searchParams;
  const page = Math.max(0, Math.min(10000, Number(params.page) || 0)) | 0;
  const db = await supabase();
  const [applications, events, policy, ...counts] = await Promise.all([
    db
      .from("client_applications")
      .select("*")
      .order("submitted_at", { ascending: false })
      .order("user_id")
      .range(page * 25, page * 25 + 25),
    db
      .from("client_access_events")
      .select("id,user_id,kind,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("client_access_policy").select("enforced").single(),
    ...["pending", "approved", "revoked"].map((s) =>
      db
        .from("client_applications")
        .select("user_id", { count: "exact", head: true })
        .eq("status", s),
    ),
  ]);
  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link href="/admin" className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            PANTHER <span className="gold">FX</span>
            <small>CLIENT RELATIONS</small>
          </span>
        </Link>
        <PerformanceRefresh />
      </header>
      <h1>Your client directory.</h1>
      <p>Registration, verified funding and account activity. All times MYT.</p>
      {params.message && <div className="message">{params.message}</div>}
      {(applications.error ||
        events.error ||
        policy.error ||
        counts.some((c) => c.error)) && (
        <div className="error-message">
          Some client records could not load. Please retry.
        </div>
      )}
      <div className="client-stat-grid">
        {["Pending", "Approved", "Revoked"].map((s, i) => (
          <div className="panel content-panel" key={s}>
            <small>{s}</small>
            <h2>{counts[i].count ?? "—"}</h2>
          </div>
        ))}
      </div>
      <section className="panel content-panel">
        <h2>
          Access control · {policy.data?.enforced ? "Enforced" : "Setup mode"}
        </h2>
        <p>
          {policy.data?.enforced
            ? "Clients need an approved application to access the terminal and signals."
            : "Existing team accounts retain access during setup. New clients must complete onboarding and remain Pending until their account is verified and approved."}
        </p>
        <form action={setGate}>
          <input
            type="hidden"
            name="enabled"
            value={policy.data?.enforced ? "false" : "true"}
          />
          <button className="secondary-button">
            {policy.data?.enforced
              ? "Return to setup mode"
              : "Enforce verified onboarding"}
          </button>
        </form>
        <small>
          Enforcement requires a client account verified within the last 10
          minutes. Monitor interruptions retain the last access decision; they
          do not count as inactivity.
        </small>
      </section>
      <section className="panel content-panel">
        <h2>Automatic account verification</h2>
        <p>
          Keep the dedicated VPS observer running to check accounts, approve
          eligible real capital and queue administrator push alerts. This
          website alone cannot read client accounts.
        </p>
        <a href="/api/admin/client-monitor" className="primary-button">
          Download VPS observer launcher
        </a>
        <p>
          Run the downloaded launcher on the VPS using the separate
          Panther-Client-Monitor terminal. Enter CLIENT_MONITOR_SECRET from the
          web service environment at its hidden prompt. Never use the
          price-bridge secret.
        </p>
        <small>
          Start with a single verification pass. Unknown transfer sources remain
          Pending for review. Existing team access is unchanged; full
          enforcement is a separate control.
        </small>
        <p>
          <Link href="/account">
            Enable notifications on this administrator device →
          </Link>
        </p>
      </section>
      <div className="client-directory">
        {applications.data?.slice(0, 25).map((a) => (
          <article className="panel content-panel" key={a.user_id}>
            <div className="signal-heading">
              <h2>{a.full_name}</h2>
              <span className="outline-tag">{a.status.toUpperCase()}</span>
            </div>
            <p>
              {a.email} · {a.phone}
            </p>
            <div className="client-detail-grid">
              <div>
                <small>Client ID</small>
                <strong>{a.client_id}</strong>
              </div>
              <div>
                <small>MT5 account</small>
                <strong>{a.mt5_login}</strong>
              </div>
              <div>
                <small>Server</small>
                <strong>{a.server}</strong>
              </div>
              <div>
                <small>Real deposits</small>
                <strong>{money(a.deposits)}</strong>
              </div>
              <div>
                <small>Withdrawals</small>
                <strong>{money(a.withdrawals)}</strong>
              </div>
              <div>
                <small>Balance / Equity</small>
                <strong>
                  {money(a.balance)} / {money(a.equity)}
                </strong>
              </div>
              <div>
                <small>Credit / Bonus</small>
                <strong>{money(a.credit)}</strong>
              </div>
              <div>
                <small>Approved</small>
                <strong>{time(a.approved_at)}</strong>
              </div>
              <div>
                <small>Last trade</small>
                <strong>{time(a.last_trade_at)}</strong>
              </div>
              <div>
                <small>Last verification</small>
                <strong>{time(a.last_checked_at)}</strong>
              </div>
            </div>
            <p
              className={
                a.last_checked_at &&
                Date.now() - Date.parse(a.last_checked_at) < 600000
                  ? ""
                  : "gold"
              }
            >
              {a.last_checked_at &&
              Date.now() - Date.parse(a.last_checked_at) < 600000
                ? "Monitoring current"
                : "Verification pending / monitor stale"}{" "}
              · {a.reason.replaceAll("_", " ")}
            </p>
            <ClientPassword id={a.user_id} />
          </article>
        ))}
      </div>
      {!applications.data?.length && (
        <section className="panel content-panel">
          No client applications yet. Client registration:{" "}
          <Link href="/onboarding">/onboarding</Link>
        </section>
      )}
      <div className="admin-actions">
        {page > 0 && (
          <Link href={`?page=${page - 1}`} className="secondary-button">
            Previous
          </Link>
        )}
        {(applications.data?.length ?? 0) > 25 && (
          <Link href={`?page=${page + 1}`} className="secondary-button">
            Next
          </Link>
        )}
      </div>
      <section className="panel content-panel">
        <h2>Access alerts</h2>
        <p>
          Approval and revocation alerts are also queued to opted-in
          administrator devices. Notifications contain no passwords or client
          contact details.
        </p>
        {events.data?.map((e) => (
          <div className="audit-row" key={e.id}>
            <strong>
              {e.kind.toUpperCase()} · {e.reason.replaceAll("_", " ")}
            </strong>
            <small>
              {e.user_id} · {time(e.created_at)}
            </small>
          </div>
        ))}
      </section>
    </main>
  );
}
