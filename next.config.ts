import type { NextConfig } from "next";

// Cache Components is deliberately OFF: every page is per-user and attendance must always be fresh,
// so pages render on each request (see the root layout's `dynamic = "force-dynamic"`).
const nextConfig: NextConfig = {
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
