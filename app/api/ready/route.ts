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
  if (
    productionIssues(process.env).length ||
    !serviceConfigured() ||
    !validVapidPair(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    )
  )
    return Response.json(
      {
        status: "not_ready",
        checks: { configuration: false, database: false },
      },
      { status: 503, headers },
    );
  const { data, error } = await serviceDb().rpc("deployment_readiness");
  if (error || data?.schema_version !== 8)
    return Response.json(
      { status: "not_ready", checks: { configuration: true, database: false } },
      { status: 503, headers },
    );
  return Response.json(
    {
      status: "ready",
      checks: { configuration: true, database: true },
      external_delivery: "unverified",
      market_feed: "disconnected",
    },
    { headers },
  );
}
