import type { MetadataRoute } from "next";

/**
 * Lets phones install the app ("Install app" / "Add to Home screen"): on Android, Chrome turns it into
 * a real installed app with its own icon and window. Needs HTTPS (or localhost).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MEI Attendance & Marks",
    short_name: "MEI Attendance",
    description: "Attendance, marks and parent alerts for MEI Polytechnic",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Take attendance", url: "/attendance" },
      { name: "Parent portal", url: "/parent" },
    ],
  };
}
