import { readFileSync } from "node:fs";
import { scanTrendlinePreview } from "../lib/engine/trendline-preview-snapshot";
import { snapshotUtc } from "../lib/engine/mt5";
const filename = process.argv[2];
if (!filename)
  throw new Error(
    "Usage: node --import tsx scripts/preview-trendline.ts <snapshot.json>",
  );
const snapshot = JSON.parse(readFileSync(filename, "utf8"));
// Assess the snapshot as it existed at export, not against today's clock.
const result = scanTrendlinePreview(
  snapshot,
  snapshotUtc(snapshot.exported_at_utc),
);
console.log(JSON.stringify(result, null, 2));
