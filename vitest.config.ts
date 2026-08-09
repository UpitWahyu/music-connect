import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/server/src/**/*.test.ts"],
    environment: "node",
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // tests hit the real Redis + MySQL from docker compose
    sequence: { concurrent: false },
  },
});
