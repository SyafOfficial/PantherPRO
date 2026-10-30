import { validVapidPair } from "@/lib/push-keys";
import { productionIssues } from "@/lib/deployment";
import { serviceConfigured, serviceDb } from "@/lib/service-db";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.APP_MODE !== "production")
    return Response.json(
      { status: "demo", production_ready: false },
      { headers },
    );
  const configurationIssues = productionIssues(process.env);
  if (!serviceConfigured())
    configurationIssues.push("Service database settings are missing");
  if (
    !validVapidPair(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    )
  )
    configurationIssues.push("VAPID key pair is missing or inconsistent");
  if (configurationIssues.length)
    return Response.json(
      {
        status: "not_ready",
        checks: { configuration: false, database: false },
        database_checked: false,
        configurationIssues,
      },
      { status: 503, headers },
    );
  const { data, error } = await serviceDb().rpc("deployment_readiness");
  if (error || data?.schema_version !== 8)
    return Response.json(
      { status: "not_ready", checks: { configuration: true, database: false } },
      { status: 503, headers },
    );
  const engine = await serviceDb()
    .from("automatic_engine_policy")
    .select("enabled,version,last_snapshot_processed")
    .eq("singleton", true)
    .maybeSingle();
  return Response.json(
    {
      status: "ready",
      automatic_engine:
        engine.error || !engine.data
          ? { installed: false }
          : {
              installed: true,
              publication_enabled: engine.data.enabled,
              version: engine.data.version,
              last_snapshot_processed: engine.data.last_snapshot_processed,
            },
      checks: { configuration: true, database: true },
      external_delivery: "unverified",
      market_feed: "disconnected",
    },
    { headers },
  );
}
