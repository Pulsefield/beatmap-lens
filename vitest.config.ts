import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    benchmark: {
      include: ["benchmarks/**/*.bench.ts"],
    },
    clearMocks: true,
    environment: "node",
    exclude: ["**/dist/**", "**/node_modules/**"],
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 5_000,
  },
});
