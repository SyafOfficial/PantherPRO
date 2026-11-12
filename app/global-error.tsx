"use client";
export default function GlobalError() {
  return (
    <html lang="en" style={{ background: "#f8f8ff", colorScheme: "light" }}>
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          background: "#f8f8ff",
          color: "#343640",
          fontFamily: "system-ui",
        }}
      >
        <main style={{ padding: 32, textAlign: "center", maxWidth: 440 }}>
          <p style={{ color: "#00556d", letterSpacing: 4 }}>PANTHER FX</p>
          <h1>Let’s Reconnect.</h1>
          <p>Your workspace could not load. Reload the app to try again.</p>
          <a
            href=""
            style={{
              display: "inline-block",
              padding: "14px 24px",
              marginTop: 16,
              background: "#00556d",
              color: "#f8f8ff",
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
