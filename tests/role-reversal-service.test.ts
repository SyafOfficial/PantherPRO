import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { automaticEngineCycle } from "../lib/engine/service";
import { ROLE_REVERSAL_VERSION } from "../lib/engine/role-reversal";
import { roleReversalSnapshot } from "./helpers/role-reversal-fixture";
import { baseSnapshot } from "./helpers/base-fixture";

test("pre-migration policy withholds SBR/RBS while existing monitoring and BOS continue; schema capability admits them", async () => {
  for (const mode of ["old-role", "new-role", "old-base"]) {
    const now = Date.now(),
      snapshot =
        mode === "old-base"
          ? baseSnapshot(true, false, now)
          : roleReversalSnapshot(true, now);
    let applied: Array<{ method: string }> | undefined;
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              error: null,
              data:
                table === "automatic_engine_policy"
                  ? {
                      enabled: true,
                      version: "vestrado-structure-v1",
                      ...(mode === "new-role"
                        ? {
                            role_reversal_schema_version: ROLE_REVERSAL_VERSION,
                          }
                        : {}),
                    }
                  : {
                      snapshot,
                      exported_at: new Date(now).toISOString(),
                      received_at: new Date(now).toISOString(),
                    },
            }),
          }),
        }),
      }),
      rpc: async (
        name: string,
        args: { plans?: Array<{ method: string }> },
      ) => {
        if (name === "apply_automatic_engine") applied = args.plans;
        return { data: { published: 0, events: 0 }, error: null };
      },
    } as unknown as SupabaseClient;
    await automaticEngineCycle(db);
    assert.ok(applied, "existing monitor transaction always runs");
    assert.equal(
      applied.some((p) => ["SBR", "RBS"].includes(p.method)),
      mode === "new-role",
    );
    if (mode === "old-base") assert.ok(applied.some((p) => p.method === "BOS"));
  }
});
