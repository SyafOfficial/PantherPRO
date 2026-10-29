import { productionIssues } from "@/lib/deployment";
import Terminal from "@/components/terminal";
import { loadIntelligence } from "@/lib/intelligence/service";
import { identity, isConfigured, supabase } from "@/lib/supabase";
import type { MarketSnapshot } from "@/lib/market-data";
export const dynamic = "force-dynamic";
export default async function Page() {
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
  let signals: Record<string, unknown>[] = [];
  let dataError = false;
  let marketError = false;
  let market: MarketSnapshot = {
    quote: null,
    events: [],
    as_of: new Date().toISOString(),
  };
  if (user) {
    const db = await supabase();
    const [signalResult, marketResult] = await Promise.all([
      db
        .from("signals")
        .select("*")
        .in("status", ["active", "pending", "closed"])
        .order("created_at", { ascending: false })
        .limit(50),
      db.rpc("get_market_snapshot"),
    ]);
    signals = signalResult.data ?? [];
    dataError = Boolean(signalResult.error);
    marketError = Boolean(marketResult.error);
    if (marketResult.data && !marketResult.error)
      market = marketResult.data as MarketSnapshot;
  }
  const intelligence = await loadIntelligence();
  return (
    <Terminal
      user={user}
      mode={isConfigured() ? "connected" : "demo"}
      signals={signals}
      dataError={dataError}
      market={market}
      marketError={marketError}
      intelligence={intelligence}
    />
  );
}
