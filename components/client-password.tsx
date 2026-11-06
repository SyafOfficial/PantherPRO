"use client";
import { useEffect, useState } from "react";
export default function ClientPassword({ id }: { id: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setValue(""), 30000);
    const hide = () => {
      if (document.hidden) setValue("");
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [value]);
  return (
    <div className="client-credential">
      {value ? (
        <>
          <code>{value}</code>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setValue("")}
          >
            Hide
          </button>
        </>
      ) : (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/admin/client-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
                cache: "no-store",
              });
              if (!r.ok) throw Error();
              const d = await r.json();
              setValue(d.password);
            } catch {
              setError("Verify MFA and retry.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening…" : "Reveal investor password"}
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
