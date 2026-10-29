"use client";
import { useState } from "react";
import { Bell, Check, Send, ShieldCheck } from "lucide-react";
type Preferences = {
  signals: boolean;
  targets: boolean;
  news: boolean;
  announcements: boolean;
  push_enabled: boolean;
};
const defaults: Preferences = {
  signals: true,
  targets: true,
  news: false,
  announcements: true,
  push_enabled: false,
};
function bytes(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export default function NotificationSettings({
  initial,
  enabled,
}: {
  initial: Preferences | null;
  enabled: boolean;
}) {
  const [preferences, setPreferences] = useState(initial ?? defaults),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      setMessage(
        response.ok
          ? "Preferences saved."
          : "Preferences could not be saved. Sign in and retry.",
      );
    } catch {
      setMessage("Connection interrupted. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function enablePush() {
    setBusy(true);
    setMessage("");
    try {
      if (!publicKey) throw new Error("Push keys are not configured.");
      if (
        !isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        throw new Error(
          "This browser does not support push here. On iOS, install the app on your Home Screen first.",
        );
      // Permission is requested from this explicit button action only.
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications were not enabled. You can change permission in browser settings.",
        );
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes(publicKey),
        }));
      const json = subscription.toJSON();
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: json.keys,
        }),
      });
      if (!response.ok)
        throw new Error(
          "Device registration failed. Sign in and retry; another account may own this subscription.",
        );
      setPreferences({ ...preferences, push_enabled: true });
      setMessage(
        "Device registered. Send a test to verify delivery; a running worker is required.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to enable push.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disablePush() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok)
          throw new Error(
            "Server registration could not be removed. Try again.",
          );
        await subscription.unsubscribe();
      }
      setMessage(
        "This device has been unregistered. Other devices keep their own settings.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to disable push.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function testPush() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
      });
      const data = await response.json();
      setMessage(
        response.ok
          ? `Test queued (${data.eventId}). Delivery is not yet confirmed; check the device and admin delivery log.`
          : (data.error ?? "Test failed."),
      );
    } catch {
      setMessage("Connection interrupted. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel content-panel">
      <Bell className="gold" size={28} />
      <h2>Notifications, on your terms.</h2>
      <p>
        Choose the updates you receive. Push requires a registered device and a
        running delivery worker. It has not been verified on this device.
      </p>
      <div className="notification-controls">
        {(
          [
            ["signals", "New signals & modifications"],
            ["targets", "Targets & stop-loss updates"],
            ["news", "High-impact news"],
            ["announcements", "Member announcements"],
            ["push_enabled", "Allow push across my registered devices"],
          ] as const
        ).map(([key, label]) => (
          <label className="preference" key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={preferences[key]}
              disabled={!enabled || busy}
              onChange={(e) =>
                setPreferences({ ...preferences, [key]: e.target.checked })
              }
            />
          </label>
        ))}
      </div>
      <div className="settings-actions">
        <button
          className="secondary-button"
          disabled={!enabled || busy}
          onClick={save}
        >
          <Check size={15} />
          Save preferences
        </button>
        <button
          className="primary-button"
          disabled={!enabled || !publicKey || busy}
          onClick={enablePush}
        >
          <Bell size={15} />
          Enable this device
        </button>
        <button
          className="secondary-button"
          disabled={!enabled || busy}
          onClick={disablePush}
        >
          Remove this device
        </button>
        <button
          className="secondary-button"
          disabled={!enabled || !publicKey || busy || !preferences.push_enabled}
          onClick={testPush}
        >
          <Send size={14} />
          Send a test push
        </button>
      </div>
      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}
      {!enabled && (
        <div className="message">
          Sign in to a configured workspace to save notification settings.
        </div>
      )}
      {!publicKey && (
        <p className="integration-note">
          <ShieldCheck size={14} />
          Push delivery is not configured. No permission is requested.
        </p>
      )}
    </section>
  );
}
