// Never cache authenticated documents or API responses.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// Browser-managed navigation: do not intercept document requests.
// Render free instances can take longer than 45 seconds to wake up.
// Keep authenticated documents, API responses, quotes and credentials uncached.
// Push notification handling below remains unchanged.

function seenStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("panther-push", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("seen", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function firstDelivery(id) {
  const db = await seenStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("seen", "readwrite");
      const store = tx.objectStore("seen");
      let first = false;
      const existing = store.get(id);
      existing.onsuccess = () => {
        if (!existing.result) {
          first = true;
          store.put({ id, time: Date.now() });
        }
      };
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          if (c.value.time < Date.now() - 30 * 86400000) c.delete();
          c.continue();
        }
      };
      tx.oncomplete = () => resolve(first);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function forgetDelivery(id) {
  const db = await seenStore();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("seen", "readwrite");
      tx.objectStore("seen").delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data.json();
      } catch {
        return;
      }
      if (
        !payload ||
        typeof payload.id !== "string" ||
        !/^[-a-zA-Z0-9]{8,80}$/.test(payload.id)
      )
        return;
      const url = new URL(
        typeof payload.url === "string" ? payload.url : "/",
        self.location.origin,
      );
      if (
        url.origin !== self.location.origin ||
        !["/", "/dashboard", "/account", "/admin/clients"].includes(
          url.pathname,
        )
      )
        return;
      if (url.pathname === "/" && url.searchParams.has("view"))
        url.pathname = "/dashboard";
      if (!(await firstDelivery(payload.id))) return;
      const progressCopies = new Map([
        ["signal.be_hit", ["Our setup HIT BE!", "Ready next zone"]],
        ["signal.tp1", ["HIT TP 1 Lads!", "Collect half now and Set BE"]],
        ["signal.tp2", ["HIT TP 2 Lads!", "Collect half now and Set BE"]],
        ["signal.tp3", ["HIT TP3!", "CLOSE ALL NOW"]],
        [
          "signal.stop_hit",
          payload.title === "Original SL reached" &&
          payload.body ===
            "50-pip BE alert was issued earlier. Check your managed position."
            ? [payload.title, payload.body]
            : ["HIT SL!", "Ready for recovery"],
        ],
        [
          "signal.break_even",
          ["Price running 50 pips!", "Collect half and Set BE"],
        ],
      ]);
      const clientCopy =
        ["client.approved", "client.revoked"].includes(payload.eventType) &&
        url.pathname === "/admin/clients" &&
        payload.title ===
          (payload.eventType === "client.approved"
            ? "Client approved"
            : "Client access revoked") &&
        typeof payload.body === "string" &&
        payload.body.length > 0 &&
        payload.body.length <= 400
          ? [payload.title, payload.body]
          : null;
      const announcementCopy =
        payload.eventType === "announcement.published" &&
        url.pathname === "/account" &&
        typeof payload.title === "string" &&
        payload.title.trim().length > 0 &&
        payload.title.length <= 150 &&
        typeof payload.body === "string" &&
        payload.body.trim().length > 0 &&
        payload.body.length <= 5000
          ? [payload.title, payload.body]
          : null;
      const copy =
        announcementCopy ??
        clientCopy ??
        progressCopies.get(payload.eventType) ??
        (payload.eventType === "signal.active"
          ? typeof payload.title === "string" &&
            payload.title.startsWith("Panther FX · XAUUSD ") &&
            typeof payload.body === "string" &&
            (payload.body.startsWith("Entry: ") ||
              payload.body.startsWith(
                "Setup closed. Do not enter.\nEntry: ",
              )) &&
            payload.body.length <= 800
            ? [payload.title, payload.body]
            : [
                "New signal · Panther FX",
                "A new signal is available. Open your terminal to view it.",
              ]
          : payload.eventType === "signal.closed"
            ? [
                "Signal closed · Panther FX",
                "A signal has closed. Open your terminal for the authorized update.",
              ]
            : payload.eventType === "signal.modified" ||
                payload.eventType === "signal.stop_loss"
              ? [
                  "Signal updated · Panther FX",
                  "A signal update is available. Open your terminal for details.",
                ]
              : [
                  "Panther FX intelligence",
                  "A new update is available. Open your terminal to review it.",
                ]);
      try {
        await self.registration.showNotification(copy[0], {
          body: copy[1],
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "panther-" + payload.id,
          data: { url: url.href },
        });
      } catch (error) {
        await forgetDelivery(payload.id);
        throw error;
      }
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(
        event.notification.data?.url || "/",
        self.location.origin,
      );
      if (
        url.origin !== self.location.origin ||
        !["/", "/dashboard", "/account", "/admin/clients"].includes(
          url.pathname,
        )
      )
        return;
      if (url.pathname === "/" && url.searchParams.has("view"))
        url.pathname = "/dashboard";
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(url.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
