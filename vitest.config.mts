import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"] } },
      // Database tests share tables (each in a rolled-back transaction): one file at a time, so they never wait on each other's locks.
      { extends: true, test: { name: "db", include: ["tests/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000 } },
    ],
  },
});
