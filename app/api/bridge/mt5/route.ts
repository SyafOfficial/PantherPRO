import {
  snapshotBody,
  snapshotDigest,
  validBridgeSignature,
} from "@/lib/engine/bridge-auth";
import {
  inspectMt5Snapshot,
  mt5SnapshotSchema,
  snapshotUtc,
} from "@/lib/engine/mt5";
import { serviceConfigured, serviceDb } from "@/lib/service-db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.MT5_BRIDGE_SECRET;
  if (
    process.env.MT5_BRIDGE_ENABLED !== "true" ||
    !secret ||
    secret.length < 32 ||
    !serviceConfigured()
  )
    return Response.json(
      { error: "Bridge not enabled" },
      { status: 503, headers },
    );
  // Authenticate header presence before accepting a potentially large body.
  const timestamp = request.headers.get("x-panther-timestamp"),
    signature = request.headers.get("x-panther-signature");
  if (
    !timestamp ||
    !signature ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 60000
  )
    return Response.json(
      { error: "Unauthorized bridge request" },
      { status: 401, headers },
    );
  let bytes: Buffer;
  try {
    bytes = await snapshotBody(request);
  } catch (error) {
    return Response.json(
      { error: "Invalid bounded snapshot body" },
      {
        status:
          error instanceof Error && error.message === "body-too-large"
            ? 413
            : 400,
        headers,
      },
    );
  }
  const digest = snapshotDigest(bytes);
  if (!validBridgeSignature(secret, timestamp, signature, digest, Date.now()))
    return Response.json(
      { error: "Unauthorized bridge request" },
      { status: 401, headers },
    );
  let snapshot, report;
  try {
    snapshot = mt5SnapshotSchema.parse(JSON.parse(bytes.toString("utf8")));
    report = inspectMt5Snapshot(snapshot, Date.now());
  } catch {
    return Response.json(
      { error: "Invalid MT5 snapshot schema" },
      { status: 422, headers },
    );
  }
  if (!report.freshness.usableCurrentQuote)
    return Response.json(
      { error: "Snapshot or broker tick is stale; no live data accepted" },
      { status: 422, headers },
    );
  const { data, error } = await serviceDb().rpc("ingest_mt5_snapshot", {
    snapshot,
    fingerprint: digest,
    export_time: new Date(snapshotUtc(snapshot.exported_at_utc)).toISOString(),
  });
  if (error)
    return Response.json(
      {
        error: "Snapshot storage rejected",
        code:
          error.code === "P0429"
            ? "rate_limit"
            : error.code === "P0409"
              ? "conflict"
              : "storage_unavailable",
      },
      {
        status:
          error.code === "P0429" ? 429 : error.code === "P0409" ? 409 : 503,
        headers,
      },
    );
  return Response.json(
    { received: true, ...data, signal_published: false },
    { status: 202, headers },
  );
}
