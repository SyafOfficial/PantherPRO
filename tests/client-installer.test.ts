import { test } from "node:test";
import assert from "node:assert/strict";
import { monitorLauncher } from "../lib/clients/installer";
test("observer launcher packages exact reviewed sources without containing credentials", () => {
  const script = monitorLauncher("print('observer')", '{"mapping":true}');
  const encoded = [...script.matchAll(/FromBase64String\('([^']+)'\)/g)].map(
    (m) => Buffer.from(m[1], "base64").toString(),
  );
  assert.deepEqual(encoded, ["print('observer')", '{"mapping":true}']);
  assert.match(script, /\$Once/);
  assert.match(script, /Panther-Client-Monitor/);
  assert.doesNotMatch(
    script,
    /CLIENT_CREDENTIAL_KEY|SUPABASE_SERVICE_ROLE_KEY|investor_password/,
  );
});
