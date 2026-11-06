import { test, expect } from "@playwright/test";

for (const width of [320, 390, 768, 1440]) {
  test(`workspace panels and controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/?view=Market%20Analysis",
      "/?view=AI%20Intelligence",
      "/?view=Economic%20Calendar",
      "/?view=Profile%20%26%20Notifications",
      "/account",
      "/admin",
      "/login",
      "/guide",
    ]) {
      await page.goto(route);
      await expect(page.locator(".app-launch-screen")).toBeHidden();
      const issues = await page.evaluate(() => {
        const problems: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 1)
          problems.push("Page overflows horizontally");
        for (const selector of [
          ".settings-actions",
          ".admin-actions",
          ".chart-toolbar",
          ".topbar",
          ".section-title",
        ]) {
          for (const group of document.querySelectorAll(selector)) {
            const children = [...group.children].filter((child) => {
              const style = getComputedStyle(child);
              return (
                child.getClientRects().length &&
                style.position !== "absolute" &&
                style.position !== "fixed"
              );
            });
            for (let i = 0; i < children.length; i++) {
              const a = children[i].getBoundingClientRect();
              for (let j = i + 1; j < children.length; j++) {
                const b = children[j].getBoundingClientRect();
                if (
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
                )
                  problems.push(`${selector}: overlapping controls`);
              }
            }
          }
        }
        return problems;
      });
      expect(issues, route).toEqual([]);
      if (route === "/admin") {
        const links = page
          .getByRole("navigation", { name: "Administration", exact: true })
          .getByRole("link");
        const a = await links.nth(0).boundingBox();
        const b = await links.nth(1).boundingBox();
        expect(
          Math.max(b!.x - a!.x - a!.width, b!.y - a!.y - a!.height),
        ).toBeGreaterThanOrEqual(11);
      }
    }
  });
}

test("long client details, statuses and revealed credentials stay inside cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/account");
  await expect(page.locator(".app-launch-screen")).toBeHidden();
  await page.locator("main").evaluate((main) => {
    main.className = "admin-page";
    main.innerHTML = `<section class="panel content-panel">
      <div class="signal-heading"><h2>Nur Aisyah Binti Abdullah Muhammad</h2><span class="outline-tag">Awaiting account verification</span></div>
      <p>averylongclientemailaddress@example.test · +60 123456789</p>
      <div class="client-detail-grid"><div><small>Client ID</small><strong>${"CLIENT".repeat(14)}</strong></div><div><small>Balance / Equity</small><strong>$123,456,789.00 / $123,456,789.00</strong></div></div>
      <div class="client-credential"><code>${"example-only-".repeat(12)}</code><button class="secondary-button">Hide investor password</button></div>
      <div class="settings-actions"><button class="primary-button">Download VPS observer launcher</button><button class="secondary-button">Enable notifications on this administrator device</button></div>
    </section><section class="panel content-panel"><h2>Account activity</h2><p>Verification details</p></section>`;
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const panels = page.locator("main > .panel");
  const first = await panels.nth(0).boundingBox();
  const second = await panels.nth(1).boundingBox();
  expect(second!.y - first!.y - first!.height).toBeGreaterThanOrEqual(20);
  const card = await panels.nth(0).boundingBox();
  for (const control of await page
    .locator("main button, main code, main strong")
    .all()) {
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(card!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width);
  }
});
