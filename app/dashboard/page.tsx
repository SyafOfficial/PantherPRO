import ClientAccessWatch from "@/components/client-access-watch";
import { redirect } from "next/navigation";
import { dashboardAccess } from "@/lib/clients/dashboard-access";
import { productionIssues } from "@/lib/deployment";
import Terminal from "@/components/terminal";
import { loadIntelligence } from "@/lib/intelligence/service";
import { identity, isConfigured, supabase } from "@/lib/supabase";
import type { MarketSnapshot } from "@/lib/market-data";
import type { DailySignalSummary } from "@/lib/signal-session";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ recentPage?: string }>;
}) {
  const params = await searchParams;
  const parsedPage = Number(params.recentPage ?? 0);
  const recentPage =
    Number.isSafeInteger(parsedPage) && parsedPage >= 0 && parsedPage <= 10000
      ? parsedPage
      : 0;
  const pageSize = 50;
  let hasMoreRecent = false;
  if (productionIssues(process.env).length)
    return (
      <main className="auth-page">
        <section className="panel auth-card">
          <h1>Service setup in progress.</h1>
          <p>
            The production service is not ready. Contact the operator; demo
            content is not substituted for a production configuration.
          </p>
        </section>
      </main>
    );
  const user = await identity();
  if (!user && (isConfigured() || process.env.APP_MODE !== "demo"))
    redirect("/login");
  if (user && !(await dashboardAccess(await supabase(), user)))
    redirect("/onboarding");
  const intelligencePromise = loadIntelligence();
  let signals: Record<string, unknown>[] = [];
  let dailySummary: DailySignalSummary | null = null;
  let dataError = false;
  let marketError = false;
  let market: MarketSnapshot = {
    quote: null,
    events: [],
    as_of: new Date().toISOString(),
  };
  if (user) {
    const db = await supabase();
    const [signalResult, marketResult, summaryResult] = await Promise.all([
      db
        .from("signals")
        .select("*")
        .in("status", ["active", "closed"])
        .eq("client_desk_visible", true)
        .or(
          `status.eq.active,published_at.gt.${new Date(Date.now() - 30 * 86400000).toISOString()}`,
        )
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .order("id", { ascending: false })
        .range(recentPage * pageSize, recentPage * pageSize + pageSize),
      db.rpc("get_market_snapshot"),
      db.rpc("get_member_signal_summary"),
    ]);
    dailySummary = summaryResult.error
      ? null
      : (summaryResult.data as DailySignalSummary);
    hasMoreRecent = (signalResult.data?.length ?? 0) > pageSize;
    signals = (signalResult.data ?? []).slice(0, pageSize);
    dataError = Boolean(signalResult.error);
    marketError = Boolean(marketResult.error);
    if (marketResult.data && !marketResult.error)
      market = marketResult.data as MarketSnapshot;
  }
  const intelligence = await intelligencePromise;
  return (
    <>
      <ClientAccessWatch enabled={Boolean(user && user.role !== "admin")} />
      <Terminal
        user={user}
        mode={isConfigured() ? "connected" : "demo"}
        signals={signals}
        recentPage={recentPage}
        hasMoreRecent={hasMoreRecent}
        dailySummary={dailySummary}
        dataError={dataError}
        market={market}
        marketError={marketError}
        intelligence={intelligence}
      />
    </>
  );
}
