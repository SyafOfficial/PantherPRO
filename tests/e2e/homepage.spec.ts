import { test, expect } from "@playwright/test";

for (const width of [320, 390, 768, 1440]) {
  test(`public welcome journey and aligned controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".app-launch-screen")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Welcome.",
    );
    await expect(
      page.locator(
        ".chart-toolbar, .welcome-page p, .welcome-page svg, .welcome-page footer",
      ),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Register", exact: true }),
    ).toHaveAttribute("href", "/login?mode=signup");
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `/tmp/panther-home-${width}.png`,
        fullPage: true,
      });
    const controls = page.locator(".welcome-actions a");
    const first = await controls.nth(0).boundingBox();
    const second = await controls.nth(1).boundingBox();
    expect(first!.height).toBeGreaterThanOrEqual(44);
    expect(second!.height).toBeGreaterThanOrEqual(44);
    expect(
      first!.y + first!.height <= second!.y + 1 ||
        first!.x + first!.width <= second!.x + 1,
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await page.getByRole("link", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Return to homepage" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}
