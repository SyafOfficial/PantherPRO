import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
// Run each file directly so the node:test subtests are visible even in restricted runners.
for (const file of readdirSync("tests")
  .filter((f) => f.endsWith(".test.ts"))
  .sort()) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", `tests/${file}`],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
