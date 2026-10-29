import webpush from "web-push";
import { writeFileSync } from "node:fs";
const keys = webpush.generateVAPIDKeys();
// Exclusive creation protects existing keys. Private material never reaches stdout.
writeFileSync(
  ".env.push.local",
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=\n`,
  { flag: "wx", mode: 0o600 },
);
console.info(
  "Wrote .env.push.local with restrictive permissions. Set a real VAPID_SUBJECT, then securely load these values into the application and worker. Never commit or paste this file.",
);
