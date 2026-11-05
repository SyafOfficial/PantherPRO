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
  if (
    input?.operation === "poll" &&
    Object.keys(input).every((k) => ["operation", "cursor"].includes(k))
  ) {
    const cursor = input.cursor;
    if (
      cursor != null &&
      (typeof cursor !== "string" || !/^[a-f0-9-]{36}$/i.test(cursor))
    )
      return new Response(null, { status: 422, headers });
    let query = db
      .from("client_applications")
      .select(
        "user_id,revision,mt5_login,server,status,last_checked_at,reviewed_bonus_comments",
      )
      .neq("status", "revoked")
      .or(
        `last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - 5 * 60000).toISOString()}`,
      )
      .order("user_id")
      .limit(25);
    if (cursor) query = query.gt("user_id", cursor);
    const { data, error } = await query;
    if (error) return new Response(null, { status: 503, headers });
    if (!data?.length)
      return Response.json({ accounts: [], next_cursor: null }, { headers });
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
          next_cursor: data.length === 25 ? data.at(-1)!.user_id : null,
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
    return Response.json(
      { accepted, status: result.status, reason: result.reason },
      { headers },
    );
  } catch {
    return new Response(null, { status: 422, headers });
  }
}
