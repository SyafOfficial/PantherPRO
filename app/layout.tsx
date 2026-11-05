import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppLaunch from "@/components/app-launch";
export const metadata: Metadata = {
  title: "PANTHER FX | Intelligence Terminal",
  description:
    "Private market intelligence for the considered trader. Gold signals, fundamental context and transparent performance.",
  applicationName: "Panther FX",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090A0F",
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppLaunch>{children}</AppLaunch>
      </body>
    </html>
  );
}
