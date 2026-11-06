import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerAdminNavigation } from "../lib/admin-navigation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminShortcuts from "../components/admin-shortcuts";

test("owner shortcuts require both the exact owner email and an existing admin role", () => {
  assert.equal(
    ownerAdminNavigation({ role: "admin", email: "apitimran2@gmail.com" }),
    true,
  );
  assert.equal(
    ownerAdminNavigation({ role: "admin", email: "APITIMRAN2@gmail.com" }),
    true,
  );
  for (const user of [
    null,
    { role: "member", email: "apitimran2@gmail.com" },
    { role: "admin", email: "another@example.com" },
    { role: "admin", email: "apitimran2@gmail.com.example.com" },
    { role: "admin" },
  ])
    assert.equal(ownerAdminNavigation(user), false);
});

test("owner shortcuts use direct admin routes and render nothing for other identities", () => {
  const markup = renderToStaticMarkup(
    createElement(AdminShortcuts, {
      user: { role: "admin", email: "apitimran2@gmail.com" },
    }),
  );
  for (const href of ["/admin", "/admin/performance", "/admin/clients"])
    assert.ok(markup.includes(`href="${href}"`));
  assert.equal(markup.includes('href="/login"'), false);
  for (const user of [
    null,
    { role: "member", email: "apitimran2@gmail.com" },
    { role: "admin", email: "another@example.com" },
  ])
    assert.equal(
      renderToStaticMarkup(createElement(AdminShortcuts, { user })),
      "",
    );
});
