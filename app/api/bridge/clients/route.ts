import { monitorAuthorized, decryptCredential } from "@/lib/clients/crypto";
import { observationSchema, assessAccount } from "@/lib/clients/rules";
import { serviceDb } from "@/lib/service-db";
const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache" };
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!monitorAuthorized(request))
    return new Response(null, { status: 401, headers });
  // Separate credential-scoped observer; never accept broker evidence from a client session.
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024)
    return new Response(null, { status: 413, headers });
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const db = serviceDb();
  if (input?.operation === "poll" && Object.keys(input).length === 1) {
    const { data, error } = await db
      .from("client_applications")
      .select("user_id,revision,mt5_login,server,status,last_checked_at")
      .neq("status", "revoked")
      .or(
        `last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - 5 * 60000).toISOString()}`,
      )
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(1000);
    if (error) return new Response(null, { status: 503, headers });
    const { data: credentials, error: ce } = await db
      .from("client_credentials")
      .select("user_id,ciphertext")
      .in(
        "user_id",
        (data ?? []).map((a) => a.user_id),
      );
    if (ce) return new Response(null, { status: 503, headers });
    try {
      return Response.json(
        {
          accounts: (data ?? []).map((a) => ({
            ...a,
            investor_password: decryptCredential(
              credentials?.find((c) => c.user_id === a.user_id)?.ciphertext ??
                "",
              a.user_id,
            ),
          })),
        },
        { headers },
      );
    } catch {
      return new Response(null, { status: 503, headers });
    }
  }
  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) return new Response(null, { status: 422, headers });
  const o = parsed.data;
  const { data: a, error } = await db
    .from("client_applications")
    .select("*")
    .eq("user_id", o.application_id)
    .single();
  if (error || !a) return new Response(null, { status: 404, headers });
  if (
    o.revision !== a.revision ||
    o.login !== a.mt5_login ||
    o.server.toLowerCase() !== a.server.toLowerCase()
  )
    return new Response(null, { status: 409, headers });
  try {
    const result = assessAccount(o, a);
    const { data: accepted, error: e } = await db.rpc(
      "record_client_assessment",
      {
        owner: a.user_id,
        expected_revision: a.revision,
        observed: o.observed_at,
        result,
      },
    );
    if (e) return new Response(null, { status: 503, headers });
    return Response.json({ accepted }, { headers });
  } catch {
    return new Response(null, { status: 422, headers });
  }
}
