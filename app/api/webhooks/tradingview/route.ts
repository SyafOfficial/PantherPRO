import {
  boundedJson,
  webhookSchema,
  validSecret,
  freshTimestamp,
  webhookFingerprint,
} from "@/lib/webhook";
import { serviceConfigured, serviceDb } from "@/lib/service-db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!serviceConfigured() || !secret || secret.length < 32)
    return Response.json(
      { error: "Webhook integration not configured" },
      { status: 503 },
    );
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return Response.json(
      {
        error:
          reason === "body-too-large"
            ? "Payload too large"
            : "Expected a bounded JSON payload",
      },
      { status: reason === "body-too-large" ? 413 : 400 },
    );
  }
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Invalid alert payload" }, { status: 400 });
  if (!validSecret(parsed.data.secret, secret))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!freshTimestamp(parsed.data.timestamp))
    return Response.json(
      { error: "Alert timestamp outside five-minute acceptance window" },
      { status: 400 },
    );
  const { secret: ignored, ...payload } = parsed.data;
  void ignored;
  const { data, error } = await serviceDb().rpc("ingest_tradingview", {
    alert: payload,
    fingerprint: webhookFingerprint(parsed.data),
  });
  if (error) {
    const status =
      error.code === "P0429" ? 429 : error.code === "P0409" ? 409 : 503;
    return Response.json(
      {
        error:
          status === 429
            ? "Alert rate limit exceeded"
            : status === 409
              ? "Event ID already used with different content"
              : "Alert could not be stored",
      },
      { status },
    );
  }
  return Response.json(data, { status: data?.duplicate ? 200 : 202 });
}
