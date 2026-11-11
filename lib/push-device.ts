/** Explicit user-action repair: replace this device only, preserving other devices. */
export async function registerPushDevice(
  registration: ServiceWorkerRegistration,
  applicationServerKey: Uint8Array<ArrayBuffer>,
  renew = false,
  fetcher: typeof fetch = fetch,
) {
  let subscription = await registration.pushManager.getSubscription();
  if (renew && subscription) {
    const removed = await fetcher("/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!removed.ok)
      throw new Error("Device could not be reconnected. Sign in and retry.");
    const unsubscribed = await subscription.unsubscribe();
    if (!unsubscribed && (await registration.pushManager.getSubscription()))
      throw new Error(
        "Browser could not renew this device. Close the app and retry.",
      );
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const response = await fetcher("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subscription.toJSON().keys,
    }),
  });
  if (!response.ok)
    throw new Error(
      "Device registration failed. Sign in and retry; another account may own this subscription.",
    );
  return subscription;
}
