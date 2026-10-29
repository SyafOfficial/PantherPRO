"use client";
import { useState } from "react";
import { signOut } from "@/app/login/actions";
export default function SignOutButton() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function leave() {
    setBusy(true);
    setError("");
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
          const response = await fetch("/api/push/subscriptions", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!response.ok)
            throw new Error(
              "Unable to unregister this device. Check your connection and retry sign-out.",
            );
          await subscription.unsubscribe().catch(() => false);
        }
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to sign out securely. Check your connection and retry.",
      );
      setBusy(false);
      return;
    }
    await signOut();
  }
  return (
    <>
      <button onClick={leave} disabled={busy} className="primary-button">
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
