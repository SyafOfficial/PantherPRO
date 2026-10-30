import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export const snapshotDigest = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");
export function bridgeSignature(
  secret: string,
  timestamp: string,
  digest: string,
) {
  return createHmac("sha256", secret)
    .update(timestamp + "." + digest)
    .digest("hex");
}
export function validBridgeSignature(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  digest: string,
  now: number,
) {
  if (
    secret.length < 32 ||
    secret.length > 256 ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !Number.isFinite(now) ||
    Math.abs(now - Number(timestamp)) > 60_000
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(bridgeSignature(secret, timestamp, digest), "hex"),
  );
}
export async function snapshotBody(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new Error("content-type");
  const limit = 2 * 1024 * 1024,
    size = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(size) || size > limit) throw new Error("body-too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty-body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) throw new Error("body-too-large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
