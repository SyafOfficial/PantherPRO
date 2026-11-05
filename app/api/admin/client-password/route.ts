import { authorizedRequest } from "@/lib/api-auth";
import { serviceDb } from "@/lib/service-db";
import { decryptCredential } from "@/lib/clients/crypto";
export async function POST(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    Pragma: "no-cache",
  };
  const auth = await authorizedRequest(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== "admin" || auth.user.aal !== "aal2")
    return Response.json(
      { error: "MFA administrator required" },
      { status: 403, headers },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return new Response(null, { status: 413, headers });
  let id;
  try {
    id = (await request.json()).id;
  } catch {
    return new Response(null, { status: 400, headers });
  }
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    return new Response(null, { status: 400, headers });
  const db = serviceDb();
  const { data, error } = await db
    .from("client_credentials")
    .select("ciphertext")
    .eq("user_id", id)
    .single();
  if (error || !data) return new Response(null, { status: 404, headers });
  const { error: auditError } = await db
    .from("audit_logs")
    .insert({
      actor_id: auth.user.id,
      action: "client.investor_password_viewed",
      entity_id: id,
      details: {},
    });
  if (auditError) return new Response(null, { status: 503, headers });
  try {
    return Response.json(
      { password: decryptCredential(data.ciphertext, id) },
      { headers },
    );
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
