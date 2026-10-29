import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
writeFileSync(
  ".env.webhook.local",
  `TRADINGVIEW_WEBHOOK_SECRET=${randomBytes(32).toString("hex")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.info(
  "Wrote .env.webhook.local with restrictive permissions. Securely merge it into server environment settings and the authorized TradingView alert. Never commit or paste it.",
);
