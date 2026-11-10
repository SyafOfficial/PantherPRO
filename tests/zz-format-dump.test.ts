import { test } from "node:test";
import { readFile } from "node:fs/promises";
import prettier from "prettier";

test("temporary formatting diagnostic", async () => {
  for (const path of ["app/admin/page.tsx", "lib/engine/mt5.ts"]) {
    const source = await readFile(path, "utf8");
    const options = await prettier.resolveConfig(path);
    const formatted = await prettier.format(source, { ...options, filepath: path });
    console.log("FORMATTED_START:" + path);
    console.log(Buffer.from(formatted).toString("base64"));
    console.log("FORMATTED_END:" + path);
  }
});
