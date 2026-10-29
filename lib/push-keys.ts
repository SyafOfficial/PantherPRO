import { createECDH, timingSafeEqual } from "node:crypto";
export function validVapidPair(
  publicKey: string | undefined,
  privateKey: string | undefined,
) {
  try {
    if (!publicKey || !privateKey) return false;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    const expected = ecdh.getPublicKey();
    const supplied = Buffer.from(publicKey, "base64url");
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  } catch {
    return false;
  }
}
