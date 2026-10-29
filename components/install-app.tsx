"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Smartphone, Bell, ShieldCheck, Check } from "lucide-react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null),
    [installed, setInstalled] = useState(false),
    [pushSupported, setPushSupported] = useState(false),
    [message, setMessage] = useState(""),
    [pushState, setPushState] = useState("Checking configuration…");
  useEffect(() => {
    setInstalled(
      matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    );
    setPushSupported(
      isSecureContext &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() =>
          setMessage(
            "Service worker registration failed. Check HTTPS and your connection.",
          ),
        );
    const before = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const added = () => {
      setInstalled(true);
      setPrompt(null);
      setMessage(
        "App installation was reported by your browser. Open it from your home screen.",
      );
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", added);
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) =>
        setPushState(
          data.integrations?.push === "disconnected"
            ? "Delivery service not configured"
            : "Configured · delivery still needs a device test",
        ),
      )
      .catch(() => setPushState("Configuration could not be checked"));
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", added);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const result = await prompt.userChoice;
    setPrompt(null);
    setMessage(
      result.outcome === "accepted"
        ? "Install request accepted. Verify the app appears on your home screen."
        : "Install prompt dismissed. You can install later from the browser menu.",
    );
  }
  return (
    <main className="install-page">
      <Link className="brand" href="/">
        <img src="/icon.svg" alt="" />
        <span>
          PANTHER <span className="gold">FX</span>
          <small>YOUR MOBILE INTELLIGENCE TERMINAL</small>
        </span>
      </Link>
      <section className="panel install-hero">
        <Smartphone size={42} />
        <div className="eyebrow">PANTHER FX · WEB APP</div>
        <h1>Your edge. On your home screen.</h1>
        <p>
          Install the web app for a dedicated phone experience. Receive signal
          updates on supported devices after sign-in, permission and push setup.
        </p>
        <button
          className="primary-button"
          onClick={install}
          disabled={!prompt || installed}
        >
          {installed ? <Check size={17} /> : <Download size={17} />}{" "}
          {installed
            ? "Running as an installed app"
            : prompt
              ? "Install Panther FX"
              : "Use your browser’s install menu"}
        </button>
        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}
        <p className="integration-note">
          Installation is free. A browser install option may depend on HTTPS,
          device support and browser eligibility.
        </p>
      </section>
      <div className="profile-grid">
        <section className="panel content-panel">
          <h2>iPhone / iPad</h2>
          <ol>
            <li>Open the deployed HTTPS app in Safari.</li>
            <li>Tap Share, then Add to Home Screen.</li>
            <li>Enable Open as Web App if shown, then tap Add.</li>
            <li>Open Panther FX from its new home-screen icon.</li>
          </ol>
          <p>
            Web Push on iOS/iPadOS requires a supported Home Screen web app
            (iOS/iPadOS 16.4 or later). Browser support and device settings
            still apply.
          </p>
        </section>
        <section className="panel content-panel">
          <h2>Android / desktop</h2>
          <ol>
            <li>Open the deployed HTTPS app in a supported browser.</li>
            <li>
              Use Install Panther FX when available, or the browser menu’s
              Install app / Add to Home screen option.
            </li>
            <li>Open the installed app and sign in.</li>
          </ol>
          <p>
            No app-store download is required. Your data and access are still
            protected by your member account.
          </p>
        </section>
      </div>
      <section className="panel content-panel">
        <h2>
          <Bell size={20} /> Get new signal notifications
        </h2>
        <ol>
          <li>Sign in to your configured member account.</li>
          <li>
            Open notification preferences and enable New signals &
            modifications.
          </li>
          <li>
            Tap Enable this device and accept the browser permission request.
          </li>
          <li>
            Send a test push, background the app and confirm an actual device
            notification.
          </li>
        </ol>
        <div className="health-row">
          <span>This browser’s push APIs</span>
          <span>
            {pushSupported
              ? "Available"
              : "Unavailable / checking device support"}
          </span>
        </div>
        <div className="health-row">
          <span>Delivery configuration</span>
          <span>{pushState}</span>
        </div>
        <p>
          After an administrator publishes a reviewed signal, the queue targets
          eligible opted-in members. There is no daily signal quota. The worker
          must be running; device settings, connectivity and service failures
          can delay delivery. A queued event is not proof of delivery.
        </p>
        <Link href="/account" className="primary-button">
          Notification preferences <Bell size={15} />
        </Link>
      </section>
      <div className="panel analysis-boundary">
        <ShieldCheck size={24} />
        <p>
          No automatic trades or guaranteed returns. QM, BOS, CHOCH and
          trendline are setup labels pending your method rules; the app does not
          invent automatic detections.
        </p>
      </div>
      <Link className="secondary-button" href="/">
        Open signal terminal →
      </Link>
    </main>
  );
}
