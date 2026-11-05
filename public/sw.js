// Never cache authenticated documents or API responses.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// A navigation must resolve to either live content or a useful retry screen.
// Never retain private documents, credentials, quotes or API data in a cache.
function connectionScreen(request, slow) {
  const url = new URL(request.url);
  const target = (url.pathname + url.search).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
  return new Response(
    `<!doctype html><html lang="en" style="background:#090a0f;color-scheme:dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090a0f"><title>Panther FX · Reconnect</title></head><body style="margin:0;min-height:100svh;display:grid;place-items:center;background:#090a0f;color:#f5f5f7;font-family:system-ui"><main style="padding:32px;max-width:400px;text-align:center"><div style="color:#d9b66f;letter-spacing:4px">PANTHER FX</div><h1>${slow ? "Let’s Reconnect." : "You Are Offline."}</h1><p style="color:#a1a3b0;line-height:1.6">${slow ? "Your workspace is taking longer than expected. Please retry in a moment." : "Connect to the internet, then reopen your workspace."}</p><a href="${target}" style="display:inline-block;margin-top:16px;padding:14px 28px;border-radius:8px;background:#d9b66f;color:#090a0f;text-decoration:none">Retry</a></main></body></html>`,
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "5",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}
async function liveNavigation(request) {
  let timer;
  const controller = new AbortController();
  try {
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(connectionScreen(request, true));
        controller.abort();
      }, 45000);
    });
    const live = fetch(request, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) =>
        response.status >= 500 ? connectionScreen(request, true) : response,
      )
      .catch(() => connectionScreen(request, false));
    return await Promise.race([live, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate" && event.request.method === "GET")
    event.respondWith(liveNavigation(event.request));
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
        !["/", "/account", "/admin/clients"].includes(url.pathname)
      )
        return;
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
      const copy =
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
        !["/", "/account", "/admin/clients"].includes(url.pathname)
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
