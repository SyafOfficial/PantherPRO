import { test, expect } from "@playwright/test";
test("desktop demo is honest, interactive and error-free", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Precision starts with perspective." }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "All prices, chart points and signals below are simulated.",
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View reasoning", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Signal reasoning" }),
  ).toBeVisible();
  await page.getByLabel("Filter signal status").selectOption("Closed");
  await expect(
    page.getByRole("heading", { name: "No signals in this view" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A track record built on evidence" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "AI Intelligence", exact: false })
    .first()
    .click();
  await expect(
    page.getByText("RULES-BASED · MODEL DISCONNECTED", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/panther-desktop-ai.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("phone navigation works without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/panther-mobile.png", fullPage: true });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Calendar" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Economic Calendar", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "VIP Membership", exact: true })
    .click();
  await expect(
    page.getByText("No subscription or payment provider is active.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("demo cannot sign in or perform administrative writes", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page.getByText("Read-only admin preview.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft for review" }),
  ).toBeDisabled();
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Sign in securely" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
});
test("PWA manifest, icons and health accurately describe readiness", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(health.headers()["content-security-policy"]).not.toContain(
    "unsafe-eval",
  );
  const status = await health.json();
  expect((await request.get("/api/market/mt5?timeframe=H1")).status()).toBe(
    401,
  );
  expect(status.mode).toBe("demo");
  expect(status.integrations.push).toBe("disconnected");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons)
    expect((await request.get(icon.src)).ok()).toBe(true);
  expect((await request.get("/sw.js")).ok()).toBe(true);
});

test("Phase 2 browser mutations fail closed without a configured account", async ({
  page,
  request,
}) => {
  await page.goto("/account");
  await expect(
    page.getByRole("button", { name: "Save preferences" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Enable this device" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send a test push" }),
  ).toBeDisabled();
  const webhook = await request.post("/api/webhooks/tradingview", { data: {} });
  expect(webhook.status()).toBe(503);
  const crossOrigin = await request.put("/api/notifications/preferences", {
    headers: { Origin: "https://untrusted.example" },
    data: { signals: true },
  });
  expect(crossOrigin.status()).toBe(403);
  const anonymous = await request.post("/api/notifications/test", {
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(anonymous.status()).toBe(401);
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Review & publish announcement" }),
  ).toBeDisabled();
});

test("simulated browser push deduplicates deliveries and rejects cross-origin links", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"], {
    origin: "http://127.0.0.1:3000",
  });
  const session = await context.newCDPSession(page);
  let registrationId = "";
  session.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
    for (const registration of registrations) {
      if (
        registration.scopeURL === "http://127.0.0.1:3000/" &&
        !registration.isDeleted
      )
        registrationId = registration.registrationId;
    }
  });
  await session.send("ServiceWorker.enable");
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => registrationId).not.toBe("");
  const id = "00000000-0000-4000-8000-000000000077";
  const send = (deliveryId: string, url: string, eventType?: string) =>
    session.send("ServiceWorker.deliverPushMessage", {
      origin: "http://127.0.0.1:3000",
      registrationId,
      data: JSON.stringify({ id: deliveryId, url, eventType }),
    });
  const notifications = () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return (await registration.getNotifications()).map((n) => ({
        title: n.title,
        tag: n.tag,
        body: n.body,
        url: n.data?.url,
      }));
    });
  await send(id, "/account#announcements");
  await expect.poll(async () => (await notifications()).length).toBe(1);
  const visible = await notifications();
  expect(visible[0].title).toBe("Panther FX intelligence");
  expect(visible[0].url).toBe("http://127.0.0.1:3000/account#announcements");
  await send(id, "/account#announcements");
  expect((await notifications()).length).toBe(1);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    for (const notification of await registration.getNotifications())
      notification.close();
  });
  await send(id, "/account#announcements");
  await send(
    "00000000-0000-4000-8000-000000000078",
    "https://untrusted.example/",
  );
  // Allow delivery tasks to finish, then inspect actual browser notification storage.
  await page.waitForTimeout(300);
  expect((await notifications()).length).toBe(0);
  await send(
    "00000000-0000-4000-8000-000000000079",
    "/?view=Signals",
    "signal.active",
  );
  await expect.poll(async () => (await notifications()).length).toBe(1);
  expect((await notifications())[0].title).toBe("New signal · Panther FX");
  expect((await notifications())[0].body).not.toContain("2340");
  for (const [index, eventType, expectedTitle] of [
    [80, "signal.tp1", "TP1 reached · Panther FX"],
    [81, "signal.tp2", "TP2 reached · Panther FX"],
    [82, "signal.tp3", "TP3 reached · Panther FX"],
    [83, "signal.stop_hit", "SL confirmed · Panther FX"],
    [84, "signal.break_even", "Trade management · Panther FX"],
  ] as const) {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      for (const notification of await registration.getNotifications())
        notification.close();
    });
    await send(
      `00000000-0000-4000-8000-0000000000${index}`,
      "/?view=Signals",
      eventType,
    );
    await expect
      .poll(async () => (await notifications())[0]?.title)
      .toBe(expectedTitle);
    if (eventType === "signal.break_even")
      expect((await notifications())[0].body).toBe(
        "Close Partial and SET Break Even now!",
      );
  }
});

test("calendar shows an honest empty state and account settings fit a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=Economic%20Calendar");
  await expect(
    page.getByRole("heading", { name: "Awaiting licensed calendar data" }),
  ).toBeVisible();
  await expect(
    page.getByText("NO PROVIDER DATA", { exact: true }),
  ).toBeVisible();
  await page.goto("/account");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/panther-account-mobile.png",
    fullPage: true,
  });
});

test("intelligence modes expose missing evidence and cannot fabricate a connected model", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=AI%20Intelligence");
  const technical = page.getByRole("article", {
    name: "Technical analysis report",
  });
  await expect(
    technical.getByText("Bias: insufficient data", { exact: true }),
  ).toBeVisible();
  await expect(
    technical.getByText("No analysis-permitted price source is connected.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pre-news scenarios", exact: true })
    .click();
  await expect(
    page
      .getByRole("article", { name: "Pre-news analysis report" })
      .getByText("Bias: insufficient data", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Post-news analysis", exact: true })
    .click();
  const post = page.getByRole("article", { name: "Post-news analysis report" });
  await expect(
    post.getByText(
      "No analysis-permitted calendar release is available for this mode.",
      { exact: true },
    ),
  ).toBeVisible();
  await post.getByText("Sources & limitations", { exact: false }).click();
  await expect(
    post.getByText("No authorized evidence is available.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const response = await request.get("/api/intelligence");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await page.screenshot({
    path: "/tmp/panther-intelligence-mobile.png",
    fullPage: true,
  });
});

test("phone install guidance, method filters and macro education work without fake live data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "XAUUSD signal news risk" }),
  ).toContainText("News risk cannot be verified");
  await page.getByLabel("Strategy", { exact: true }).selectOption("QM");
  await expect(
    page.getByRole("heading", { name: "No signals in this view" }),
  ).toBeVisible();
  await page
    .getByLabel("Strategy", { exact: true })
    .selectOption("All strategies");
  await page.getByLabel("Setup timeframe", { exact: true }).selectOption("W1");
  await expect(
    page.getByRole("heading", { name: "No signals in this view" }),
  ).toBeVisible();
  await page.goto("/?view=Economic%20Calendar");
  await page
    .getByText("Federal Reserve rate decision", { exact: true })
    .click();
  await expect(
    page.getByText(
      "Compare actual with consensus and the previous target; a cut is not automatically a dovish surprise.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const label of [
    "FOMC communications",
    "Non-Farm Payrolls (NFP)",
    "Consumer Price Index (CPI)",
    "Producer Price Index (PPI)",
    "Purchasing Managers’ Index (PMI)",
  ])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/install");
  await expect(
    page.getByRole("heading", { name: "Your edge. On your home screen." }),
  ).toBeVisible();
  await expect(
    page.getByText("Delivery service not configured", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", {
      cancelable: true,
    }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
  });
  await page
    .getByRole("button", { name: "Install Panther FX", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Install prompt dismissed",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/panther-phone-install.png",
    fullPage: true,
  });
});

test("account recovery, two-factor setup and readiness fail closed in demo", async ({
  page,
  request,
}) => {
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("button", { name: "Request recovery link" }),
  ).toBeDisabled();
  await page.goto("/account/password");
  await expect(
    page.getByRole("button", { name: "Update password" }),
  ).toBeDisabled();
  await page.goto("/account/security");
  await expect(
    page.getByRole("button", { name: "Set up authenticator" }),
  ).toBeDisabled();
  const ready = await request.get("/api/ready");
  expect((await ready.json()).production_ready).toBe(false);
  await page.goto("/admin");
  await expect(
    page
      .getByLabel("Strategy", { exact: false })
      .getByRole("option", { name: /QMTR/ }),
  ).toHaveCount(0);
});

test("production script nonces are unique and unsigned script injection is blocked", async ({
  page,
  request,
}) => {
  const first = await request.get("/");
  const second = await request.get("/");
  const a = first.headers()["content-security-policy"],
    b = second.headers()["content-security-policy"];
  const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(a)?.[1];
  expect(nonce).toBeTruthy();
  expect(a).not.toBe(b);
  expect(a.split(";").find((v) => v.includes("script-src"))).not.toContain(
    "unsafe-inline",
  );
  await page.goto("/");
  const scriptNonces = await page
    .locator("script")
    .evaluateAll((scripts) =>
      scripts.map((s) => (s as HTMLScriptElement).nonce).filter(Boolean),
    );
  expect(scriptNonces.length).toBeGreaterThan(0);
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "<head>",
      "<head><script>window.__unsignedExecuted=true</script>",
    );
    await route.fulfill({ response, body });
  });
  await page.goto("/");
  const executed = await page.evaluate(() =>
    Boolean(
      (window as unknown as { __unsignedExecuted?: boolean })
        .__unsignedExecuted,
    ),
  );
  expect(executed).toBe(false);
});
