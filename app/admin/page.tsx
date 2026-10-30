import Link from "next/link";
import { integrationStatus } from "@/lib/integrations";
import { identity, isConfigured, supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import StrategyFields from "@/components/strategy-fields";
import SignalEditor from "@/components/signal-editor";
import ObservationControl from "@/components/observation-control";
import {
  setAutomaticEngine,
  createSignal,
  transitionSignal,
  changeMemberRole,
  publishAnnouncement,
} from "./actions";
export const dynamic = "force-dynamic";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const demo = !isConfigured();
  const user = await identity();
  if (!demo && user?.role !== "admin")
    redirect("/login?message=Administrator+access+required.");
  if (!demo && user?.aal !== "aal2")
    redirect(
      "/account/security?message=Verify+your+authenticator+to+continue.",
    );
  const db = demo ? null : await supabase();
  const [signals, profiles, audits, deliveries, outbox, providers, quotes] = db
    ? await Promise.all([
        db
          .from("signals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
        db.from("profiles").select("id,display_name,role").limit(50),
        db
          .from("audit_logs")
          .select("id,action,created_at,entity_id")
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("notification_deliveries")
          .select("id,outbox_id,state,attempts,error_code,delivered_at")
          .order("id")
          .limit(50),
        db
          .from("notification_outbox")
          .select("id,event_type,state,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("data_providers")
          .select(
            "id,display_name,kind,enabled,display_allowed,reconciliation_allowed,analysis_allowed",
          ),
        db
          .from("market_quotes")
          .select("id,provider_id,source_name,bid,ask,observed_at")
          .order("observed_at", { ascending: false })
          .limit(20),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  const enginePolicy = db
    ? await db
        .from("automatic_engine_policy")
        .select(
          "enabled,version,updated_at,last_snapshot_processed,last_result",
        )
        .eq("singleton", true)
        .single()
    : null;
  const allowedQuotes = (quotes.data ?? []).filter((q) =>
    (providers.data ?? []).some(
      (p) => p.id === q.provider_id && p.enabled && p.reconciliation_allowed,
    ),
  );
  const params = await searchParams;
  return (
    <div className="admin-page">
      <header className="admin-header">
        <Link href="/" className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            PANTHER <span className="gold">FX</span>
            <small>ADMINISTRATION</small>
          </span>
        </Link>
        <Link href="/" className="secondary-button">
          Client terminal →
        </Link>
      </header>
      {demo && (
        <div className="demo-banner">
          <strong>Read-only admin preview.</strong> No accounts, private records
          or administrative operations are available in demo mode.
        </div>
      )}
      <h1>Command center.</h1>
      <p>Review first. Publish deliberately. Every change leaves a record.</p>
      {params.message && (
        <div className="message" role="status">
          {params.message}
        </div>
      )}
      {(signals.error ||
        profiles.error ||
        audits.error ||
        deliveries.error ||
        outbox.error ||
        providers.error ||
        quotes.error) && (
        <div className="error-message">
          Some admin records could not load. Verify the database migration and
          policies.
        </div>
      )}
      <section className="panel content-panel">
        <div className="eyebrow">AUTOMATIC MT5 SIGNALS</div>
        <h2>
          {enginePolicy?.data?.enabled
            ? "Automatic publication enabled"
            : "Automatic publication paused"}
        </h2>
        <p>
          QM, BOS, CHOCH and trendline rules on M15–MN1. A completed M5 retest,
          aligned higher context and three structural targets are required.
          Entry zone ≤80 pips; SL buffer 30 pips outside the zone. No daily
          signal quota.
        </p>
        <p>
          Signals use observed Vestrado prices, not broker fills. M5-close
          invalidation can differ from a hard MT5 stop. Missing or stale data
          suppresses signals; SELL requires actual ask M5 candles. This initial
          ruleset has no verified trading performance.
        </p>
        {enginePolicy?.data && (
          <p>
            Last snapshot processed by worker:{" "}
            {enginePolicy.data.last_snapshot_processed
              ? new Date(
                  enginePolicy.data.last_snapshot_processed,
                ).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }) +
                " MYT"
              : "Waiting for worker and fresh MT5 data"}
          </p>
        )}
        {enginePolicy?.data ? (
          <form action={setAutomaticEngine}>
            <input
              type="hidden"
              name="enabled"
              value={enginePolicy.data.enabled ? "false" : "true"}
            />
            <button className="primary-button" disabled={demo}>
              {enginePolicy.data.enabled
                ? "Pause new automatic signals"
                : "Enable automatic signals"}
            </button>
          </form>
        ) : (
          <p>
            Automatic engine migration is not installed. Existing manual signals
            and notifications remain available.
          </p>
        )}
        <small>
          Already active automatic signals continue observation when new
          publication is paused. The persistent worker runs the engine; no
          manual signal form is required.
        </small>
      </section>
      <div className="admin-grid">
        <div>
          <section className="panel content-panel">
            <div className="eyebrow">MANUAL SIGNAL</div>
            <h2>Create a considered setup</h2>
            <form action={createSignal} className="form">
              <StrategyFields required />
              <label>
                Instrument
                <input value="XAUUSD · Gold / US Dollar" readOnly />
              </label>
              <label>
                Direction
                <select name="direction">
                  <option>BUY</option>
                  <option>SELL</option>
                </select>
              </label>
              {[
                ["entry", "Entry price"],
                ["stop_loss", "Stop loss"],
                ["tp1", "Take profit 1"],
                ["tp2", "Take profit 2"],
                ["tp3", "Take profit 3"],
              ].map(([n, l]) => (
                <label key={n}>
                  {l}
                  <input
                    name={n}
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    disabled={demo}
                  />
                </label>
              ))}
              <label>
                Access
                <select name="access">
                  <option value="public">Public members</option>
                  <option value="vip">VIP members</option>
                </select>
              </label>
              <label>
                Reasoning
                <textarea
                  name="reasoning"
                  minLength={20}
                  maxLength={2000}
                  required
                  disabled={demo}
                />
              </label>
              <button disabled={demo} className="primary-button">
                Save draft for review
              </button>
              <small>
                Draft → Pending review → Active → Closed. Publishing does not
                execute trades.
              </small>
            </form>
          </section>
          <section className="panel content-panel">
            <h2>Integration health</h2>
            <p>
              Provider adapters require authorized accounts. Imported
              observations do not prove a continuous connection.
            </p>
            {providers.data?.map((p) => (
              <div className="health-row" key={p.id}>
                <span>
                  {p.display_name} · {p.kind}
                </span>
                <span className="outline-tag">
                  {p.enabled ? "ENABLED" : "DISABLED"} ·{" "}
                  {p.display_allowed ? "DISPLAY" : "NO DISPLAY"}
                </span>
              </div>
            ))}
            {Object.entries(integrationStatus()).map(([key, status]) => (
              <div className="health-row" key={key}>
                <span>{key}</span>
                <span className="outline-tag">
                  {status.replaceAll("_", " ").toUpperCase()}
                </span>
              </div>
            ))}
          </section>
        </div>
        <div>
          <section className="panel content-panel">
            <div className="eyebrow">REVIEW & PUBLISH</div>
            <h2>Signal management</h2>
            {!signals.data?.length && (
              <p>
                No signals yet. Create a draft to begin the approval workflow.
              </p>
            )}
            {signals.data?.map((s) => (
              <article className="admin-signal" key={s.id}>
                <h3>
                  {s.instrument} · {s.direction}
                  <span className="outline-tag">{s.status}</span>
                </h3>
                <p>
                  Entry {s.entry} · SL {s.stop_loss}
                  <br />
                  Targets {s.tp1} / {s.tp2} / {s.tp3}
                </p>
                <p>{s.reasoning}</p>
                <div className="admin-actions">
                  {(s.status === "draft"
                    ? ["pending"]
                    : s.status === "pending"
                      ? ["active", "closed"]
                      : s.status === "active"
                        ? ["closed"]
                        : []
                  ).map((next) => (
                    <form action={transitionSignal} key={next}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="status" value={next} />
                      <button
                        className={
                          next === "active"
                            ? "primary-button"
                            : "secondary-button"
                        }
                      >
                        {next === "pending"
                          ? "Submit for review"
                          : next === "active"
                            ? "Approve & publish"
                            : "Close signal"}
                      </button>
                    </form>
                  ))}
                </div>
                <SignalEditor signal={s} />
                <ObservationControl signal={s} quotes={allowedQuotes} />
              </article>
            ))}
          </section>
          <section className="panel content-panel">
            <div className="eyebrow">MEMBERSHIP CONTROL</div>
            <h2>Members & VIP access</h2>
            <p>
              Administrator grants require a privileged database operation,
              never a client-side role change.
            </p>
            {!profiles.data?.length && <p>No member records available.</p>}
            {profiles.data?.map((p) => (
              <div className="admin-member" key={p.id}>
                <strong>{p.display_name}</strong>
                <p>{p.id}</p>
                {p.role === "admin" ? (
                  <span className="outline-tag">ADMINISTRATOR · PROTECTED</span>
                ) : (
                  <form action={changeMemberRole} className="form">
                    <input type="hidden" name="id" value={p.id} />
                    <label>
                      Membership
                      <select name="role" defaultValue={p.role}>
                        <option value="public">Public</option>
                        <option value="vip">VIP</option>
                      </select>
                    </label>
                    <button className="secondary-button">Save access</button>
                  </form>
                )}
              </div>
            ))}
          </section>
          <section className="panel content-panel">
            <h2>Audit trail</h2>
            {!audits.data?.length && <p>No recorded actions.</p>}
            {audits.data?.map((a) => (
              <div className="audit-row" key={a.id}>
                <strong>
                  {a.action} · {a.entity_id}
                </strong>
                {new Intl.DateTimeFormat("en-MY", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kuala_Lumpur",
                }).format(new Date(a.created_at))}{" "}
                MYT
              </div>
            ))}
          </section>
          <section className="panel content-panel">
            <h2>Notification delivery</h2>
            <p>
              “Delivered” means accepted by a push service, not confirmed
              display on a device. A completed event with no recipients sends no
              push.
            </p>
            <div className="delivery-stats">
              {["delivered", "pending", "failed"].map((state) => (
                <div key={state}>
                  <strong>
                    {deliveries.data?.filter((d) => d.state === state).length ??
                      0}
                  </strong>
                  <small>{state}</small>
                </div>
              ))}
            </div>
            {!outbox.data?.length && <p>No queued events.</p>}
            {outbox.data?.map((o) => (
              <div className="delivery-row" key={o.id}>
                <strong>{o.event_type}</strong>
                <span className="outline-tag">{o.state}</span>
                <code>{o.id}</code>
              </div>
            ))}
            {deliveries.data?.map((d) => (
              <div className="delivery-row" key={d.id}>
                <span className="outline-tag">{d.state}</span>
                <span>Attempts: {d.attempts}</span>
                <span>{d.error_code || "No error"}</span>
                <code>{d.id}</code>
              </div>
            ))}
          </section>
          <section className="panel content-panel">
            <h2>Publish an announcement</h2>
            <form action={publishAnnouncement} className="form">
              <label>
                Title
                <input name="title" required maxLength={150} disabled={demo} />
              </label>
              <label>
                Announcement
                <textarea
                  name="body"
                  required
                  maxLength={5000}
                  disabled={demo}
                />
              </label>
              <label>
                Audience
                <select name="access">
                  <option value="public">Public members</option>
                  <option value="vip">VIP members</option>
                </select>
              </label>
              <button className="primary-button" disabled={demo}>
                Review & publish announcement
              </button>
              <small>
                Publishing creates an audited record and queues notifications
                for eligible opted-in members.
              </small>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
