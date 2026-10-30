import { test } from "node:test";
import assert from "node:assert/strict";
import {
  snapshotDigest,
  bridgeSignature,
  validBridgeSignature,
  snapshotBody,
} from "../lib/engine/bridge-auth";
const now = 1793363953000,
  stamp = String(now),
  secret = "fixture-only-secret-".repeat(3);
test("bridge signatures bind body and timestamp; stale, malformed and wrong-secret requests fail", () => {
  const digest = snapshotDigest(Buffer.from('{"fixture":true}')),
    signature = bridgeSignature(secret, stamp, digest);
  assert.equal(
    validBridgeSignature(secret, stamp, signature, digest, now),
    true,
  );
  for (const result of [
    validBridgeSignature(secret, stamp, signature, digest, now + 60001),
    validBridgeSignature(secret, stamp, signature, digest, now - 60001),
    validBridgeSignature(secret, "invalid", signature, digest, now),
    validBridgeSignature(secret, stamp, "f".repeat(64), digest, now),
    validBridgeSignature("short", stamp, signature, digest, now),
    validBridgeSignature(
      secret,
      stamp,
      signature,
      snapshotDigest(Buffer.from("changed")),
      now,
    ),
  ])
    assert.equal(result, false);
});
test("bridge body has a streamed byte cap and checks content type before parsing", async () => {
  const raw = Buffer.from('{"fixture":true}');
  assert.equal(
    (
      await snapshotBody(
        new Request("https://app.example", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: raw,
        }),
      )
    ).toString(),
    raw.toString(),
  );
  await assert.rejects(
    snapshotBody(
      new Request("https://app.example", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: raw,
      }),
    ),
  );
  await assert.rejects(
    snapshotBody(
      new Request("https://app.example", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "3000000",
        },
        body: raw,
      }),
    ),
    /body-too-large/,
  );
  await assert.rejects(
    snapshotBody(
      new Request("https://app.example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new Uint8Array(2 * 1024 * 1024 + 1),
      }),
    ),
    /body-too-large/,
  );
});
