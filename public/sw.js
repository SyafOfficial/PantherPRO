// Never cache authenticated documents or API responses.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Panther FX · Offline</title><body style="background:#090A0F;color:#F5F5F7;font-family:system-ui;padding:40px"><h1>You are offline</h1><p>Connect to the internet to open your intelligence terminal. Market information is never served from an offline cache.</p></body></html>',
            { headers: { "Content-Type": "text/html" } },
          ),
      ),
    );
});

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
        !["/", "/account"].includes(url.pathname)
      )
        return;
      if (!(await firstDelivery(payload.id))) return;
      const progressCopies = new Map([
        [
          "signal.tp1",
          [
            "TP1 reached · Panther FX",
            "TP1 was reached on the observed feed. Open your terminal for details.",
          ],
        ],
        [
          "signal.tp2",
          [
            "TP2 reached · Panther FX",
            "TP2 was reached on the observed feed. Open your terminal for details.",
          ],
        ],
        [
          "signal.tp3",
          [
            "TP3 reached · Panther FX",
            "TP3 was reached on the observed feed. Open your terminal for details.",
          ],
        ],
        [
          "signal.stop_hit",
          [
            "SL confirmed · Panther FX",
            "M5 closed beyond the signal stop level. Open your terminal for details.",
          ],
        ],
        [
          "signal.break_even",
          [
            "Trade management · Panther FX",
            "Close Partial and SET Break Even now!",
          ],
        ],
      ]);
      const copy =
        progressCopies.get(payload.eventType) ??
        (payload.eventType === "signal.active"
          ? [
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
        !["/", "/account"].includes(url.pathname)
      )
        return;
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
