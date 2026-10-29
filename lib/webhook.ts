import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { signalSchema } from "./signals";
export const webhookSchema = signalSchema
  .safeExtend({
    secret: z.string().min(32).max(256),
    event_id: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();
export function validSecret(candidate: string, expected: string) {
  if (expected.length < 32 || candidate.length > 256) return false;
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
export function freshTimestamp(timestamp: string, now = Date.now()) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && Math.abs(now - time) <= 5 * 60 * 1000;
}
export function webhookFingerprint(data: z.infer<typeof webhookSchema>) {
  // Canonical order; authentication material is never persisted or hashed into audit records.
  const values: unknown[] = [
    data.event_id,
    data.timestamp,
    data.instrument,
    data.direction,
    data.entry,
    data.stop_loss,
    data.tp1,
    data.tp2,
    data.tp3,
    data.reasoning,
    data.access,
  ];
  if (data.strategy || data.timeframe || data.higher_timeframe)
    values.push(
      data.strategy ?? null,
      data.timeframe ?? null,
      data.higher_timeframe ?? null,
    );
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
export async function boundedJson(
  request: Request,
  maxBytes = 8192,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error("content-type");
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBytes) throw new Error("body-too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty-body");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("body-too-large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
