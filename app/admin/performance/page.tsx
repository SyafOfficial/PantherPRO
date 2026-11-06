import Link from "next/link";
import { redirect } from "next/navigation";
import { identity, supabase } from "@/lib/supabase";
import { performanceRange, type PerformanceReport } from "@/lib/performance";
import { STRATEGIES, TIMEFRAMES } from "@/lib/strategy";
import PerformanceRefresh from "@/components/performance-refresh";
export const dynamic = "force-dynamic";
const price = (v: number) => Number(v).toFixed(2);
const pips = (v: number) =>
  Number(v).toLocaleString("en-MY", { maximumFractionDigits: 1 });
const time = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
export default async function Performance({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    strategy?: string;
    timeframe?: string;
  }>;
}) {
  const user = await identity();
  if (user?.role !== "admin")
    redirect("/login?message=Administrator+access+required.");
  if (user.aal !== "aal2")
    redirect(
      "/account/security?message=Verify+your+authenticator+to+continue.",
    );
  const params = await searchParams;
  let range = performanceRange();
  let error = "";
  try {
    range = performanceRange(params.from, params.to);
  } catch (e) {
    error = (e as Error).message;
  }
  const strategy = STRATEGIES.includes(
    params.strategy as (typeof STRATEGIES)[number],
  )
    ? params.strategy
    : undefined;
  const timeframe = TIMEFRAMES.includes(
    params.timeframe as (typeof TIMEFRAMES)[number],
  )
    ? params.timeframe
    : undefined;
  let report: PerformanceReport | null = null;
  if (!error) {
    const db = await supabase();
    const result = await db.rpc("get_admin_signal_performance", {
      from_time: range.fromTime,
      to_time: range.toTime,
      strategy_filter: strategy ?? null,
      timeframe_filter: timeframe ?? null,
    });
    if (result.error)
      error = "Performance could not be loaded. Refresh to retry.";
    else report = result.data as PerformanceReport;
  }
  const s = report?.summary;
  return (
    <main className="admin-page performance-page">
      <header className="admin-header">
        <Link className="secondary-button" href="/admin">
          ← Admin Workspace
        </Link>
        <PerformanceRefresh />
      </header>
      <h1>Performance Statistics</h1>
      <p>Admin Only · All Dates And Times In MYT</p>
      <form className="performance-filters" method="get">
        <label>
          From
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? range.from}
            required
          />
        </label>
        <label>
          To
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? range.to}
            required
          />
        </label>
        <label>
          Strategy
          <select name="strategy" defaultValue={strategy ?? ""}>
            <option value="">All Strategies</option>
            {STRATEGIES.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Setup Timeframe
          <select name="timeframe" defaultValue={timeframe ?? ""}>
            <option value="">All Timeframes</option>
            {TIMEFRAMES.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button className="primary-button">Apply</button>
      </form>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {s && (
        <>
          <div className="performance-stats">
            {[
              ["Total Signals", s.signals],
              ["Setup Win Rate", s.win_rate === null ? "—" : `${s.win_rate}%`],
              ["Setup Wins / Losses", `${s.wins} / ${s.losses}`],
              ["BE Exits", s.be],
              ["Total Signal Pips", pips(s.total_pips)],
              ["TP Pips", pips(s.tp_pips)],
              ["SL Pips", `−${pips(s.sl_pips)}`],
              ["Provisional Running", `+${pips(s.running_pips)}`],
            ].map(([label, value]) => (
              <section className="panel performance-stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <p className="performance-note">
            Win: +50 pips or any TP. A later BE keeps the setup win. Pips
            reflect the exit outcome, not account profit.
          </p>
          <p>
            {s.active} Active · {s.closed} Closed · {s.unclassified}{" "}
            Unclassified · TP1: {s.tp1_hits} · TP2: {s.tp2_hits} · TP3:{" "}
            {s.tp3_hits} · SL Hits: {s.sl_hits} · BE Alerts: {s.be_alerts}
          </p>
          <section className="panel content-panel">
            <h2>By Setup</h2>
            <div className="performance-table">
              <table>
                <thead>
                  <tr>
                    {[
                      "Strategy",
                      "Setup / Higher TF",
                      "Signals",
                      "Setup Wins / Losses / BE",
                      "Setup Win Rate",
                      "TP1 / TP2 / TP3",
                      "SL Hits",
                      "TP Pips",
                      "SL Pips",
                      "Running",
                      "Total Pips",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report!.by_setup.map((g, i) => (
                    <tr key={i}>
                      <td>{g.strategy}</td>
                      <td>
                        {g.timeframe} / {g.higher_timeframe}
                      </td>
                      <td>{g.signals}</td>
                      <td>
                        {g.wins} / {g.losses} / {g.be}
                      </td>
                      <td>{g.win_rate === null ? "—" : `${g.win_rate}%`}</td>
                      <td>
                        {g.tp1_hits} / {g.tp2_hits} / {g.tp3_hits}
                      </td>
                      <td>{g.sl_hits}</td>
                      <td>{pips(g.tp_pips)}</td>
                      <td>−{pips(g.sl_pips)}</td>
                      <td>+{pips(g.running_pips)}</td>
                      <td>{pips(g.total_pips)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!s.signals && <p>No Signals In This Date Range.</p>}
          </section>
          <section className="panel content-panel">
            <h2>Signal History</h2>
            <p>
              Latest {report!.details_limit} Details · Totals Include The Full
              Date Range · Updated {time(report!.as_of)}
            </p>
            <div className="performance-table">
              <table>
                <thead>
                  <tr>
                    {[
                      "Published / Closed",
                      "Setup",
                      "Entry",
                      "TP1",
                      "TP2",
                      "TP3",
                      "SL",
                      "BE",
                      "Result",
                      "Pips",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report!.signals.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {time(r.published_at)}
                        <small>Closed: {time(r.closed_at)}</small>
                        <small>{r.id.slice(0, 8)}</small>
                      </td>
                      <td>
                        {r.strategy ?? "Unclassified"} · {r.direction}
                        <small>
                          {r.timeframe ?? "—"} / {r.higher_timeframe ?? "—"}
                        </small>
                        {r.monitoring_gap && <small>Monitoring Gap</small>}
                      </td>
                      <td>{price(r.entry)}</td>
                      {([1, 2, 3] as const).map((n) => (
                        <td key={n}>
                          {price(r[`tp${n}`])}
                          <small>{r[`tp${n}_hit_at`] ? "Hit" : "No Hit"}</small>
                          {r[`tp${n}_hit_at`] && (
                            <small>{time(r[`tp${n}_hit_at`])}</small>
                          )}
                        </td>
                      ))}
                      <td>
                        {price(r.stop_loss)}
                        <small>{r.sl_hit_at ? "Hit" : "No Hit"}</small>
                        {r.sl_hit_at && <small>{time(r.sl_hit_at)}</small>}
                      </td>
                      <td>
                        {price(r.entry)}
                        <small>
                          {r.be_exit_at
                            ? "BE Hit"
                            : r.be_alert
                              ? "BE Set"
                              : "—"}
                        </small>
                        <small>{time(r.be_exit_at ?? r.be_alert_at)}</small>
                      </td>
                      <td>
                        {r.outcome}
                        {r.setup_win && <small>Setup win</small>}
                        <small>{r.status}</small>
                      </td>
                      <td>{pips(r.total_pips)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
