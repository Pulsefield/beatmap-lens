import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "beatmap-lens": fileURLToPath(
        new URL("../../packages/beatmap-lens/src/index.ts", import.meta.url),
      ),
    },
  },
});
