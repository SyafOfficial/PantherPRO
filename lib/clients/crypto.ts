import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
function key() {
  const raw = process.env.CLIENT_CREDENTIAL_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw))
    throw Error("Client credential storage unavailable");
  return Buffer.from(raw, "hex");
}
export function credentialReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function encryptCredential(value: string, owner: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptCredential(value: string, owner: string) {
  const [v, iv, tag, body] = value.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw Error("Invalid credential");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export function monitorAuthorized(request: Request) {
  const expected = process.env.CLIENT_MONITOR_SECRET ?? "";
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(expected),
    b = Buffer.from(supplied);
  return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}
