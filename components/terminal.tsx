"use client";
import { useEffect, useState } from "react";
import MT5Chart from "@/components/mt5-chart";
import MarketContextPanel, {
  OfficialNewsPanel,
} from "@/components/market-context";
import type { MT5Display } from "@/lib/engine/display";
import Link from "next/link";
import CalendarEvents from "./calendar-events";
import { STRATEGIES, TIMEFRAMES } from "@/lib/strategy";
import NewsGuide from "./news-guide";
import NewsRisk from "./news-risk";
import IntelligencePanel from "./intelligence-panel";
import type { IntelligenceBundle } from "@/lib/intelligence/types";
import {
  quoteFreshness,
  malaysiaTime,
  type MarketSnapshot,
} from "@/lib/market-data";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Clock3,
  Crown,
  Globe2,
  Layers3,
  Menu,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  X,
  CalendarDays,
  Radio,
  ArrowRight,
  Check,
  LogIn,
} from "lucide-react";
const sections = [
  "Signals",
  "Market Analysis",
  "AI Intelligence",
  "Economic Calendar",
  "Performance",
  "VIP Membership",
  "Profile & Notifications",
];
const icons = [
  Layers3,
  ChartNoAxesCombined,
  Sparkles,
  CalendarDays,
  Activity,
  Crown,
  UserRound,
];
type Props = {
  mode: "demo" | "connected";
  user: { name: string; role: string; email?: string } | null;
  signals: Record<string, unknown>[];
  dataError: boolean;
  market: MarketSnapshot;
  marketError: boolean;
  intelligence: IntelligenceBundle;
};
const samples = [
  {
    id: "DEMO-001",
    instrument: "XAUUSD",
    direction: "BUY",
    entry: 2340,
    stop_loss: 2328,
    tp1: 2352,
    tp2: 2364,
    tp3: 2376,
    reasoning:
      "Illustrative bullish structure following a support retest. This is a fictional scenario for exploring the interface, not a recommendation.",
    status: "active",
    access: "public",
    created_at: "2026-01-15T01:30:00Z",
    is_demo: true,
  },
];
export default function Terminal({
  mode,
  user,
  signals,
  dataError,
  market,
  marketError,
  intelligence,
}: Props) {
  const router = useRouter();
  const [clock, setClock] = useState(Date.parse(market.as_of));
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const technicalBias =
    intelligence.technical.valid_until &&
    clock >= Date.parse(intelligence.technical.valid_until)
      ? "insufficient_data"
      : intelligence.technical.bias;
  const [mt5, setMt5] = useState<MT5Display | null>(null);
  const [mt5Error, setMt5Error] = useState(false);
  const quote = mt5?.quote ?? market.quote;
  const fresh = quote
    ? quoteFreshness(quote, clock) && (!mt5 || !mt5Error)
    : false;
  const quoteValue = quote
    ? Number(quote.bid).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
  useEffect(() => {
    if (
      mode !== "connected" ||
      !user ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    )
      return;
    const db = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    const channel = db
      .channel("authorized-signals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "signals" },
        () => router.refresh(),
      )
      .subscribe();
    const timer = setInterval(() => router.refresh(), 15000);
    return () => {
      void db.removeChannel(channel);
      clearInterval(timer);
    };
  }, [mode, user?.email, router]);
  useEffect(() => {
    const signal = new URLSearchParams(location.search).get("signal");
    const event = new URLSearchParams(location.search).get("event");
    if (event)
      setTimeout(
        () =>
          document
            .getElementById(`event-${event}`)
            ?.scrollIntoView({ block: "center" }),
        100,
      );
    if (signal)
      document
        .getElementById(`signal-${signal}`)
        ?.scrollIntoView({ block: "center" });
  }, [signals]);
  const [view, setView] = useState("Signals"),
    [mobile, setMobile] = useState(false),
    [filter, setFilter] = useState("All signals"),
    [timeframe, setTimeframe] = useState(mode === "demo" ? "1H" : "H1"),
    [notice, setNotice] = useState(false);
  useEffect(() => {
    if (mode !== "connected" || !user) {
      setMt5(null);
      return;
    }
    let stopped = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 2000);
        return;
      }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch(
          `/api/market/mt5?timeframe=${encodeURIComponent(timeframe)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("feed unavailable");
        const data = await response.json();
        if (!stopped) {
          setMt5(data);
          setMt5Error(false);
        }
      } catch {
        if (!stopped) setMt5Error(true);
      } finally {
        clearTimeout(timeout);
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    let timer: ReturnType<typeof setTimeout>;
    setMt5(null);
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [mode, user?.email, timeframe]);
  const demo = mode === "demo";
  const all = demo ? samples : signals;
  const [strategyFilter, setStrategyFilter] = useState("All strategies"),
    [timeframeFilter, setTimeframeFilter] = useState("All timeframes");
  const shown = all.filter(
    (s) =>
      (filter === "All signals" || String(s.status) === filter.toLowerCase()) &&
      (strategyFilter === "All strategies" || s.strategy === strategyFilter) &&
      (timeframeFilter === "All timeframes" || s.timeframe === timeframeFilter),
  );
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const v = new URLSearchParams(location.search).get("view");
    if (v && sections.includes(v)) setView(v);
  }, []);
  function navigate(s: string) {
    setView(s);
    setMobile(false);
    history.replaceState(null, "", `?view=${encodeURIComponent(s)}`);
  }
  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Link href="/" className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            PANTHER<span className="gold"> FX</span>
            <small>INTELLIGENCE TERMINAL</small>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {sections.map((s, i) => {
            const Icon = icons[i];
            return (
              <button
                key={s}
                className={`nav-item ${s === view ? "selected" : ""}`}
                onClick={() => navigate(s)}
              >
                <Icon size={19} />
                <span>{s}</span>
                {s === "AI Intelligence" && (
                  <span className="tiny-tag">AI</span>
                )}
                {s === "Signals" && (
                  <span className="nav-count">
                    {all.filter((s) => s.status === "active").length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="club-card">
            <Crown size={22} />
            <h3>Your edge. Elevated.</h3>
            <p>A more considered approach to the markets.</p>
            <button onClick={() => navigate("VIP Membership")}>
              Explore Panther VIP <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="system-state">
            <span className="dot muted-dot" />{" "}
            {demo ? "Demo environment" : "Database connected"}
            <span>v0.1</span>
          </div>
          <Link href="/login" className="account">
            <span className="avatar">{user?.name?.slice(0, 1) || "G"}</span>
            <span>
              {user?.name || "Guest explorer"}
              <small>
                {user?.role === "vip"
                  ? "VIP member"
                  : user
                    ? "Public member"
                    : "Demo access"}
              </small>
            </span>
            <Settings2 size={17} />
          </Link>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            <Link className="install-link" href="/install">
              Install app
            </Link>
            <span className="session">
              <span className="dot muted-dot" />
              {demo ? "DEMO SESSION" : "MEMBER TERMINAL"}
            </span>
            <button
              className="icon-button notification"
              aria-label="View notifications"
              onClick={() => setNotice(!notice)}
            >
              <Bell size={19} />
            </button>
            <span className="divider" />
            <Link className="avatar small" href="/login" aria-label="Account">
              {user?.name?.slice(0, 1) || "G"}
            </Link>
          </div>
          {notice && (
            <div className="notification-popover">
              <strong>Notification center</strong>
              <p>
                Open account settings to manage preferences and test push
                delivery.
              </p>
              <button
                className="text-button"
                onClick={() => {
                  navigate("Profile & Notifications");
                  setNotice(false);
                }}
              >
                Manage preferences <ArrowRight size={14} />
              </button>
            </div>
          )}
        </header>
        <main>
          <div className="demo-banner">
            <ShieldCheck size={16} />
            <span>
              {demo ? (
                <>
                  <strong>Demo workspace</strong>
                  <span className="banner-detail">
                    {" "}
                    — All prices, chart points and signals below are simulated.
                    No live feed connected.
                  </span>
                </>
              ) : (
                <>
                  <strong>Member workspace</strong> — Market updates show source
                  timestamps. Automatic signals follow configured rules; no
                  guaranteed outcomes.
                </>
              )}
            </span>
            <span className="outline-tag">
              {demo ? "SIMULATED DATA" : mt5 ? "MT5 FEED" : "CONNECTED"}
            </span>
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">THE PANTHER PERSPECTIVE</div>
              <h1>
                {view === "Signals"
                  ? "Precision starts with perspective."
                  : view}
              </h1>
              <p>
                {view === "Signals"
                  ? "Gold intelligence. Clear conviction. A disciplined edge."
                  : descriptions[view]}
              </p>
            </div>
            <div className="heading-date">
              <Globe2 size={16} />
              <span>
                Asia / Kuala Lumpur<small>UTC +08:00</small>
              </span>
            </div>
          </div>
          {marketError && (
            <div className="error-message" role="alert">
              Market data could not be loaded. Check the data migration and
              provider configuration. No substitute data is shown.
            </div>
          )}
          {view === "Signals" ? (
            <>
              <div className="stat-grid">
                <Stat
                  label="FOCUS INSTRUMENT"
                  value="XAU / USD"
                  sub="Gold · US Dollar"
                  icon={<Layers3 size={17} />}
                />
                <Stat
                  label="MARKET PRICE"
                  value={demo ? "2,346.80" : quoteValue}
                  sub={
                    demo
                      ? "Illustrative price · not live"
                      : quote
                        ? `${fresh ? "Bid" : "Stale bid"} · ${quote.source_name}`
                        : "Waiting for MT5 feed"
                  }
                  icon={<Activity size={17} />}
                  badge={
                    demo
                      ? "DEMO"
                      : quote
                        ? fresh
                          ? "SOURCE QUOTE"
                          : "STALE"
                        : undefined
                  }
                />
                <Stat
                  label="ACTIVE SIGNALS"
                  value={String(
                    all.filter((s) => s.status === "active").length,
                  ).padStart(2, "0")}
                  sub={
                    demo
                      ? "Simulated signal"
                      : "Published signals you can access"
                  }
                  icon={<Radio size={17} />}
                />
                <Stat
                  label="VERIFIED PERFORMANCE"
                  value="—"
                  sub="No verified results available"
                  icon={<Target size={17} />}
                />
              </div>
              <div className="market-grid">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div className="instrument-heading">
                      <span className="instrument-symbol">
                        Au<small>79</small>
                      </span>
                      <div>
                        <h2>
                          Gold / U.S. Dollar{" "}
                          <span className="outline-tag">XAUUSD</span>
                        </h2>
                        <p>
                          {demo
                            ? "Illustrative market structure"
                            : "Market data unavailable"}{" "}
                          <span>·</span> {timeframe} timeframe
                        </p>
                      </div>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => navigate("Market Analysis")}
                      aria-label="Open market analysis"
                    >
                      <ArrowUpRight size={20} />
                    </button>
                  </div>
                  <div className="chart-toolbar">
                    <div className="chart-price">
                      {demo ? "2,346.80" : quoteValue}{" "}
                      <span>{demo ? "USD" : "USD · BID"}</span>
                      {demo ? (
                        <small>SIMULATED · NOT A LIVE QUOTE</small>
                      ) : (
                        quote && (
                          <small>
                            {fresh
                              ? "SOURCE TIMESTAMP"
                              : "STALE · NOT A CURRENT QUOTE"}{" "}
                            ·{" "}
                            {mt5
                              ? new Intl.DateTimeFormat("en-MY", {
                                  timeZone: "Asia/Kuala_Lumpur",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                  hour12: false,
                                }).format(new Date(quote.observed_at))
                              : malaysiaTime(quote.observed_at)}{" "}
                            MYT
                          </small>
                        )
                      )}
                    </div>
                    <div className="segmented">
                      {(demo
                        ? ["15M", "1H", "4H", "1D"]
                        : ["M5", "M15", "M30", "H1", "H4", "W1", "MN1"]
                      ).map((t) => (
                        <button
                          onClick={() => setTimeframe(t)}
                          className={t === timeframe ? "active" : ""}
                          key={t}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {demo ? (
                    <Chart timeframe={timeframe} />
                  ) : mt5 ? (
                    <MT5Chart data={mt5} fresh={fresh && !mt5Error} />
                  ) : (
                    <div className="chart-empty">
                      <ChartNoAxesCombined />
                      <h3>
                        {quote
                          ? "Broker chart unavailable"
                          : mt5Error
                            ? "MT5 feed unavailable"
                            : "Loading MT5 feed"}
                      </h3>
                      <p>
                        {quote
                          ? `Source bid ${quote.bid} / ask ${quote.ask}. No candlestick history is available.`
                          : "Waiting for actual broker prices and completed candles. The display retries automatically."}
                      </p>
                    </div>
                  )}
                  <div className="chart-footer">
                    <span>
                      <span className="dot gold-dot" />
                      {demo
                        ? "PANTHER FX · DEMO CHART"
                        : quote
                          ? quote.source_name.toUpperCase()
                          : "MT5 FEED PENDING"}
                    </span>
                    <span>
                      {mt5
                        ? `${mt5Error ? "Connection interrupted · " : ""}Bid ${mt5.quote.bid.toFixed(2)} / Ask ${mt5.quote.ask.toFixed(2)} · snapshots ~10s`
                        : "No exchange connection"}
                    </span>
                  </div>
                </section>
                <section className="panel intelligence">
                  <div className="panel-heading">
                    <h2>
                      <Sparkles size={17} /> Intelligence brief
                    </h2>
                    <span className="purple-tag">RULES</span>
                  </div>
                  <div className="intelligence-orb">
                    <Sparkles size={26} />
                  </div>
                  <span className="eyebrow purple-text">
                    CONTEXT BEFORE CONVICTION
                  </span>
                  <h3>
                    The bigger picture.
                    <br />
                    Before your next move.
                  </h3>
                  <p>
                    Technical structure and fundamental context, brought into
                    one considered view.
                  </p>
                  <div className="insight-row">
                    <span>Market outlook</span>
                    <span className={`neutral-tag bias-${technicalBias}`}>
                      {technicalBias.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="insight-row">
                    <span>Analysis method</span>
                    <strong>Source-backed rules</strong>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => navigate("AI Intelligence")}
                  >
                    Explore intelligence <ArrowRight size={16} />
                  </button>
                  <small>Model disconnected. No guaranteed outcomes.</small>
                </section>
              </div>
              <NewsRisk events={market.events} now={clock} />
              <section className="signals-section">
                <div className="method-filters">
                  <label>
                    Strategy
                    <select
                      aria-label="Strategy"
                      value={strategyFilter}
                      onChange={(e) => setStrategyFilter(e.target.value)}
                    >
                      <option>All strategies</option>
                      {STRATEGIES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Setup timeframe
                    <select
                      aria-label="Setup timeframe"
                      value={timeframeFilter}
                      onChange={(e) => setTimeframeFilter(e.target.value)}
                    >
                      <option>All timeframes</option>
                      {TIMEFRAMES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <p>
                    QM · BOS · CHOCH · Trendline
                    <br />
                    M15 to Monthly. No daily signal target; setups require
                    review.
                  </p>
                </div>
                <div className="section-title">
                  <div>
                    <h2>
                      Signal desk{" "}
                      <span className="count-pill">{all.length}</span>
                    </h2>
                    <p>A structured view of every opportunity.</p>
                  </div>
                  <div className="filter">
                    <label className="sr-only" htmlFor="signal-filter">
                      Filter signal status
                    </label>
                    <select
                      id="signal-filter"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      {["All signals", "Active", "Pending", "Closed"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>
                {dataError && (
                  <div className="error-message">
                    Signals could not be loaded. Check the Supabase schema and
                    connection.
                  </div>
                )}
                {shown.length ? (
                  shown.map((s) => (
                    <SignalCard key={String(s.id)} signal={s} demo={demo} />
                  ))
                ) : (
                  <Empty
                    title="No signals in this view"
                    text="Published signals that match your access level will appear here."
                  />
                )}
              </section>
              <div className="lower-grid">
                <section className="panel compact-panel">
                  <div className="section-title">
                    <h2>
                      <CalendarDays size={17} /> On the horizon
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => navigate("Economic Calendar")}
                    >
                      Calendar <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="empty-inline">
                    <span className="calendar-tile">
                      <CalendarDays size={22} />
                    </span>
                    <div>
                      <strong>Every release needs context.</strong>
                      <p>Connect a licensed calendar for upcoming events.</p>
                    </div>
                    <span className="outline-tag">NOT CONNECTED</span>
                  </div>
                </section>
                <section className="panel compact-panel approach">
                  <ShieldCheck size={25} />
                  <div>
                    <h3>Discipline is the advantage.</h3>
                    <p>
                      Know your risk. Respect your plan.
                      <br />
                      Never trade more than you can afford to lose.
                    </p>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <Section
              view={view}
              user={user}
              navigate={navigate}
              demo={demo}
              events={market.events}
              intelligence={intelligence}
              mt5={mt5}
              marketFresh={fresh && !mt5Error}
              chartTimeframe={timeframe}
              onChartTimeframe={setTimeframe}
            />
          )}
          <footer>
            <span className="footer-brand">
              PANTHER FX <span>INTELLIGENCE</span>
            </span>
            <p>
              Trading leveraged instruments involves significant risk. You may
              lose your entire capital. Information is educational and does not
              constitute financial advice. No guaranteed returns.
            </p>
            <span className="footer-mode">
              {demo ? "DEMO ENVIRONMENT" : "INTELLIGENCE TERMINAL"}
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {sections.slice(0, 4).map((s, i) => {
          const Icon = icons[i];
          return (
            <button
              onClick={() => navigate(s)}
              className={view === s ? "active" : ""}
              key={s}
            >
              <Icon size={20} />
              <span>
                {["Signals", "Markets", "Intelligence", "Calendar"][i]}
              </span>
            </button>
          );
        })}
        <button onClick={() => setMobile(true)}>
          <Menu size={20} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
const descriptions: Record<string, string> = {
  "Market Analysis": "Structure, momentum and the context behind gold.",
  "AI Intelligence": "A considered view. Grounded in sources.",
  "Economic Calendar":
    "The events that shape the market. All times in Malaysia time.",
  Performance: "Transparent records. Measured outcomes.",
  "VIP Membership": "A deeper perspective for the disciplined trader.",
  "Profile & Notifications": "Your account. Your preferences. Your control.",
};
function Stat({
  label,
  value,
  sub,
  icon,
  badge,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <div className="stat-value">
        {value}
        {badge && <span className="outline-tag">{badge}</span>}
      </div>
      <p>{sub}</p>
    </div>
  );
}
function Chart({ timeframe }: { timeframe: string }) {
  const seed = ["15M", "1H", "4H", "1D"].indexOf(timeframe);
  const candles = Array.from({ length: 57 }, (_, i) => {
    const base =
      210 - i * 1.65 + Math.sin(i * 0.41 + seed) * 24 + Math.cos(i * 0.9) * 8;
    const up = Math.sin(i * 2.3) > -0.2;
    const h = 8 + ((i * 7) % 20);
    return { x: 20 + i * 11.5, y: base, h, up };
  });
  return (
    <div className="chart">
      <svg
        viewBox="0 0 760 300"
        role="img"
        aria-label={`Simulated gold candlestick chart at ${timeframe}. Fictional data; no market connection.`}
      >
        <defs>
          <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#D9B66F" stopOpacity=".1" />
            <stop offset="1" stopColor="#D9B66F" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[45, 95, 145, 195, 245].map((y, i) => (
          <g key={y}>
            <line
              x1="0"
              y1={y}
              x2="688"
              y2={y}
              stroke="#232630"
              strokeDasharray="3 5"
            />
            <text x="705" y={y + 4} fill="#626777" fontSize="10">
              {2380 - i * 15}.00
            </text>
          </g>
        ))}
        <rect
          x="0"
          y="178"
          width="688"
          height="34"
          fill="#d9b66f"
          fillOpacity=".035"
        />
        <text x="13" y="201" fill="#8c7952" fontSize="9" letterSpacing="1">
          ILLUSTRATIVE SUPPORT ZONE
        </text>
        <path
          d="M20 240 Q180 210 290 215 T660 120"
          stroke="#d9b66f"
          opacity=".45"
          fill="none"
          strokeWidth="1.5"
        />
        {candles.map((c, i) => (
          <g key={i} stroke={c.up ? "#67b6a2" : "#a86470"}>
            <line x1={c.x + 3} y1={c.y - 7} x2={c.x + 3} y2={c.y + c.h + 9} />
            <rect
              x={c.x}
              y={c.y}
              width="6"
              height={c.h}
              rx=".7"
              fill={c.up ? "#67b6a2" : "#a86470"}
            />
          </g>
        ))}
        <line
          x1="0"
          y1="123"
          x2="690"
          y2="123"
          stroke="#d9b66f"
          opacity=".6"
          strokeDasharray="4 4"
        />
        <rect x="690" y="114" width="69" height="19" rx="3" fill="#d9b66f" />
        <text x="697" y="127" fill="#121318" fontSize="10">
          2,346.80
        </text>
        {["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"].map((t, i) => (
          <text key={t} x={20 + i * 128} y="287" fill="#626777" fontSize="10">
            {t}
          </text>
        ))}
        <text
          x="330"
          y="55"
          fill="#727684"
          opacity=".45"
          fontSize="21"
          fontWeight="600"
          letterSpacing="5"
        >
          DEMO
        </text>
      </svg>
    </div>
  );
}
function SignalCard({
  signal: s,
  demo,
}: {
  signal: Record<string, unknown>;
  demo: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const buy = s.direction === "BUY";
  return (
    <article id={`signal-${s.id}`} className="panel signal-card">
      <div className="signal-top">
        <div className="signal-identity">
          <span className={`direction-icon ${buy ? "buy" : "sell"}`}>
            {buy ? <ArrowUpRight size={23} /> : <ArrowDownLeft size={23} />}
          </span>
          <div>
            <h3>
              {String(s.instrument)}{" "}
              <span className={buy ? "buy-text" : "sell-text"}>
                {String(s.direction)}
              </span>
            </h3>
            <p>
              Gold / US Dollar <span>·</span>{" "}
              {demo
                ? "Simulated setup"
                : s.engine_version
                  ? "Automatic rules signal · observed feed"
                  : "Administrator-reviewed signal"}
            </p>
          </div>
        </div>
        <div className="signal-badges">
          {demo && <span className="outline-tag">DEMO</span>}
          <span className="status-tag">
            <span className="dot" />
            {String(s.status)}
          </span>
          <button
            className="icon-button"
            onClick={() => setExpanded(!expanded)}
            aria-label={
              expanded ? "Hide signal details" : "Show signal details"
            }
            aria-expanded={expanded}
          >
            <ChevronDown
              size={19}
              style={{ transform: expanded ? "rotate(180deg)" : undefined }}
            />
          </button>
        </div>
      </div>
      <div className="signal-levels">
        {[
          [s.engine_version ? "ENTRY ZONE" : "ENTRY", s.entry],
          [s.engine_version ? "M5 CLOSE SL" : "STOP LOSS", s.stop_loss],
          ["TAKE PROFIT 1", s.tp1],
          ["TAKE PROFIT 2", s.tp2],
          ["TAKE PROFIT 3", s.tp3],
        ].map(([label, value], i) => (
          <div key={String(label)}>
            <span>
              <span className={`level-dot level-${i}`} />
              {String(label)}
            </span>
            <strong>
              {i === 0 && s.engine_version
                ? `${Number(s.entry_low).toFixed(2)} – ${Number(s.entry_high).toFixed(2)}`
                : Number(value).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </strong>
          </div>
        ))}
      </div>
      <div className="signal-meta">
        <span>
          <Clock3 size={13} />
          {new Intl.DateTimeFormat("en-MY", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kuala_Lumpur",
          }).format(new Date(String(s.created_at)))}{" "}
          MYT
        </span>
        <span>
          <ShieldCheck size={13} />
          {demo ? "Fictional · not actionable" : `${s.access} access`}
        </span>
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Less detail" : "View reasoning"}
          <ArrowRight size={14} />
        </button>
      </div>
      {expanded && (
        <div className="signal-details">
          <h4>Signal reasoning</h4>
          <p>
            Strategy: {String(s.strategy ?? "Unclassified")} · setup:{" "}
            {String(s.timeframe ?? "Not supplied")} · higher context:{" "}
            {String(s.higher_timeframe ?? "Not supplied")}
          </p>
          <p>{String(s.reasoning)}</p>
          {!demo && (
            <p>
              Quote observation:{" "}
              {String(s.reconciliation_state ?? "not_started").replaceAll(
                "_",
                " ",
              )}
              . Observed touches are not broker fills or verified performance.
            </p>
          )}
          <div className="detail-grid">
            <span>
              TP1 / TP2 / TP3{" "}
              <strong>
                {demo
                  ? "Not evaluated"
                  : [s.tp1_hit_at, s.tp2_hit_at, s.tp3_hit_at]
                      .map(
                        (t, i) =>
                          `TP${i + 1}: ${t ? "Observed" : "Not observed"}`,
                      )
                      .join(" · ")}
              </strong>
            </span>
            <span>
              Break-even{" "}
              <strong>{s.break_even ? "Recorded" : "Not recorded"}</strong>
            </span>
            <span>
              Observed favorable movement{" "}
              <strong>
                {s.max_favorable_movement == null
                  ? "Unavailable"
                  : String(s.max_favorable_movement)}
              </strong>
            </span>
            <span>
              Source{" "}
              <strong>{demo ? "Simulated fixture" : String(s.source)}</strong>
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="panel empty-state">
      <div className="empty-icon">
        <Layers3 size={25} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Section({
  view,
  user,
  navigate,
  demo,
  events,
  intelligence,
  mt5,
  marketFresh,
  chartTimeframe,
  onChartTimeframe,
}: {
  mt5: MT5Display | null;
  marketFresh: boolean;
  chartTimeframe: string;
  onChartTimeframe: (frame: string) => void;
  view: string;
  user: Props["user"];
  events: MarketSnapshot["events"];
  intelligence: IntelligenceBundle;
  navigate: (s: string) => void;
  demo: boolean;
}) {
  if (view === "Market Analysis" && !demo)
    return (
      <MarketContextPanel
        data={mt5}
        fresh={marketFresh}
        timeframe={chartTimeframe}
        onTimeframe={onChartTimeframe}
      />
    );
  if (view === "VIP Membership")
    return (
      <div className="membership panel">
        <Crown size={42} />
        <div className="eyebrow">PANTHER PRIVATE MEMBERSHIP</div>
        <h2>
          A sharper perspective.
          <br />A more deliberate approach.
        </h2>
        <p>
          VIP infrastructure is prepared for exclusive signals, deeper context
          and member announcements. No subscription or payment provider is
          active.
        </p>
        <div className="membership-features">
          {[
            "Administrator-reviewed signal access",
            "Protected member intelligence",
            "Individual notification preferences",
          ].map((t) => (
            <span key={t}>
              <Check size={17} />
              {t}
            </span>
          ))}
        </div>
        <Link href="/login" className="primary-button">
          {user ? "Manage your account" : "Create your account"}
          <ArrowRight size={17} />
        </Link>
        <small>
          Membership is granted by an administrator. No payment collected.
        </small>
      </div>
    );
  if (view === "Profile & Notifications")
    return (
      <div className="profile-grid">
        <section className="panel content-panel">
          <UserRound className="gold" size={28} />
          <h2>{user?.name || "Your private workspace"}</h2>
          <p>
            {user?.email ||
              "Sign in to manage your account and notification preferences."}
          </p>
          <span className="outline-tag">{user?.role || "GUEST"}</span>
          <br />
          <Link className="primary-button" href="/login">
            {user ? "Account settings" : "Sign in / Create account"}
            <LogIn size={16} />
          </Link>
          {user?.role === "admin" && (
            <Link href="/admin" className="secondary-button">
              Open administration
            </Link>
          )}
        </section>
        <section className="panel content-panel">
          <Bell className="gold" size={28} />
          <h2>Your updates. Your control.</h2>
          <p>
            Manage notification categories, register this device and send a
            delivery test from your account settings.
          </p>
          <Link href="/account" className="primary-button">
            Manage notification preferences →
          </Link>
          <p>
            Push requires configured keys and a running worker. Device delivery
            remains unverified.
          </p>
        </section>
      </div>
    );
  if (view === "Performance")
    return (
      <>
        <div className="stat-grid">
          {[
            "TOTAL CLOSED",
            "WIN / LOSS",
            "BREAK-EVEN",
            "AVERAGE RISK / REWARD",
          ].map((x) => (
            <Stat
              key={x}
              label={x}
              value="—"
              sub="Verified outcomes required"
              icon={<Activity size={17} />}
            />
          ))}
        </div>
        <Empty
          title="A track record built on evidence"
          text="There are no verified historical results yet. Demo signals are excluded from performance. Future results must include source prices, timestamps, costs and pricing assumptions."
        />
      </>
    );
  if (view === "AI Intelligence")
    return <IntelligencePanel bundle={intelligence} />;
  if (view === "Economic Calendar")
    return (
      <>
        <div className="panel content-panel">
          <div className="section-title">
            <h2>
              <CalendarDays size={20} />
              Economic releases
            </h2>
            <span className="outline-tag">MALAYSIA TIME · UTC+8</span>
          </div>
          <p>
            Provider-sourced releases, forecasts and revisions. Missing figures
            stay unavailable. No calendar or AI reaction is invented.
          </p>
        </div>
        <CalendarEvents events={events} />
        {!demo && <OfficialNewsPanel />}
        <NewsGuide />
      </>
    );
  return (
    <>
      <div className="panel content-panel">
        <div className="section-title">
          <h2>
            <ChartNoAxesCombined size={21} /> XAUUSD · Market structure
          </h2>
          <span className="outline-tag">{demo ? "DEMO" : "NO DATA FEED"}</span>
        </div>
        {demo ? (
          <Chart timeframe="4H" />
        ) : (
          <Empty
            title="No authorized price feed"
            text="Connect a licensed market provider to begin analysis."
          />
        )}
      </div>
      <div className="three-grid">
        {[
          "Trend & momentum",
          "Support & resistance",
          "Volatility & confluence",
        ].map((x) => (
          <section key={x} className="panel content-panel">
            <TrendingUp className="gold" size={22} />
            <h3>{x}</h3>
            <p>
              Insufficient authorized market data. No live analysis available.
            </p>
            <button
              className="text-button"
              onClick={() => navigate("AI Intelligence")}
            >
              Intelligence context <ArrowUpRight size={15} />
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
