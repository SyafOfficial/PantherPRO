import { createClient } from "@supabase/supabase-js";
import { productionIssues, publicOrigin } from "../lib/deployment";
import { validVapidPair } from "../lib/push-keys";
const config: Record<string, string | undefined> = {
  ...process.env,
  APP_MODE: "production",
};
const issues = productionIssues(config);
if (
  !validVapidPair(config.NEXT_PUBLIC_VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY)
)
  issues.push("VAPID key pair is missing or inconsistent");
if (issues.length) {
  console.info(
    JSON.stringify({ ready: false, configurationIssues: issues }, null, 2),
  );
  process.exit(1);
}
const db = createClient(
  config.NEXT_PUBLIC_SUPABASE_URL!,
  config.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data, error } = await db.rpc("deployment_readiness");
if (error || data?.schema_version !== 8) {
  console.info(
    JSON.stringify({
      ready: false,
      database:
        "Apply and verify migrations 001–008 in the intended Supabase project.",
    }),
  );
  process.exit(1);
}
try {
  const response = await fetch(publicOrigin(config) + "/api/ready", {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const status = await response.json();
  if (!response.ok || status.status !== "ready") throw new Error();
  console.info(
    JSON.stringify({
      ready: true,
      configuration: "valid",
      database: "schema_verified",
      httpsApp: "responding",
      pushDeviceDelivery: "requires_physical_device_test",
    }),
  );
} catch {
  console.info(
    JSON.stringify({
      ready: false,
      database: "schema_verified",
      httpsApp: "unreachable_or_not_ready",
    }),
  );
  process.exitCode = 1;
}
