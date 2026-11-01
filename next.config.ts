import type { NextConfig } from "next";

// Cache Components is deliberately OFF: every page is per-user and attendance must always be fresh,
// so pages render on each request (see the root layout's `dynamic = "force-dynamic"`).
/**
 * Security headers on every response. No full script CSP (Next's inline scripts would need nonces on
 * every page); these block the attacks that matter here: framing (clickjacking a marks or attendance
 * form), MIME sniffing, leaking URLs with student ids to other sites, and forms posting elsewhere.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Only over HTTPS in production; harmless to send, ignored on http://localhost.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
