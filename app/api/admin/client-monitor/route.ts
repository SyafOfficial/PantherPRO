import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { identity } from "@/lib/supabase";
import { monitorLauncher } from "@/lib/clients/installer";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const user = await identity();
  if (!user)
    return new Response("Sign in on this browser first.", {
      status: 401,
      headers,
    });
  if (user.role !== "admin" || user.aal !== "aal2")
    return new Response("Administrator MFA required.", {
      status: 403,
      headers,
    });
  const [observer, mapping] = await Promise.all([
    readFile(join(process.cwd(), "monitoring/vestrado_clients.py"), "utf8"),
    readFile(join(process.cwd(), "monitoring/vestrado-mapping.json"), "utf8"),
  ]);
  return new Response(monitorLauncher(observer, mapping), {
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        'attachment; filename="Start-PantherClientMonitor.ps1"',
    },
  });
}
