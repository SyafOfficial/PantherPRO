import { isConfigured } from "@/lib/supabase";
import { integrationStatus } from "@/lib/integrations";
export function GET() {
  return Response.json({
    status: "ok",
    mode: isConfigured() ? "configured" : "demo",
    integrations: integrationStatus(),
  });
}
