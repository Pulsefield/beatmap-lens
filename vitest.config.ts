import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "beatmap-lens": fileURLToPath(
        new URL("./packages/beatmap-lens/src/index.ts", import.meta.url),
      ),
    },
  },
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
