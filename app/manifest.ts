import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Panther FX Intelligence",
    short_name: "Panther FX",
    description: "Your private market intelligence terminal",
    id: "/",
    scope: "/",
    start_url: "/",
    shortcuts: [
      { name: "Signals", url: "/?view=Signals" },
      { name: "News calendar", url: "/?view=Economic%20Calendar" },
      { name: "Notifications", url: "/account" },
    ],
    display: "standalone",
    background_color: "#090A0F",
    theme_color: "#090A0F",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
