import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppLaunch from "@/components/app-launch";
import AmbientTrail from "@/components/ambient-trail";
export const metadata: Metadata = {
  title: "PANTHER FX | Intelligence Terminal",
  description:
    "Private market intelligence for the considered trader. Gold signals, fundamental context and transparent performance.",
  applicationName: "Panther FX",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F8F8FF",
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={{ background: "#f8f8ff", colorScheme: "light" }}>
      <body style={{ background: "#f8f8ff", margin: 0 }}>
        <AmbientTrail />
        <AppLaunch>{children}</AppLaunch>
      </body>
    </html>
  );
}
