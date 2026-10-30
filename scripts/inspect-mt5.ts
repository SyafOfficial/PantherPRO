import { readFile, stat } from "node:fs/promises";
import { inspectMt5Snapshot } from "../lib/engine/mt5";
async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: node --import tsx scripts/inspect-mt5.ts snapshot.json",
    );
  if ((await stat(path)).size > 2 * 1024 * 1024)
    throw new Error("Snapshot exceeds 2 MiB");
  const data = await readFile(path);
  if (data.length > 2 * 1024 * 1024) throw new Error("Snapshot exceeds 2 MiB");
  let report;
  try {
    report = inspectMt5Snapshot(
      JSON.parse(data.toString("utf8").replace(/^\uFEFF/, "")),
      Date.now(),
    );
  } catch {
    throw new Error(
      "Invalid MT5 snapshot. Check schema, candle chronology, symbol and price geometry. Contents are not logged.",
    );
  }
  console.info(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "MT5 inspection failed",
  );
  process.exitCode = 1;
});
