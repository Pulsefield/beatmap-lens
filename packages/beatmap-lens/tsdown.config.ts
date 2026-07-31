import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["esm"],
  minify: false,
  outExtensions: () => ({ js: ".js" }),
  sourcemap: true,
  target: "es2022",
});
