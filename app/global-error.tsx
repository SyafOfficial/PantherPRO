"use client";
export default function GlobalError() {
  return (
    <html lang="en" style={{ background: "#090a0f", colorScheme: "dark" }}>
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          background: "#090a0f",
          color: "#f5f5f7",
          fontFamily: "system-ui",
        }}
      >
        <main style={{ padding: 32, textAlign: "center", maxWidth: 440 }}>
          <p style={{ color: "#d9b66f", letterSpacing: 4 }}>PANTHER FX</p>
          <h1>Let’s Reconnect.</h1>
          <p>Your workspace could not load. Reload the app to try again.</p>
          <a
            href=""
            style={{
              display: "inline-block",
              padding: "14px 24px",
              marginTop: 16,
              background: "#d9b66f",
              color: "#090a0f",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Reload App
          </a>
        </main>
      </body>
    </html>
  );
}
