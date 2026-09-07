import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// JSON source-path array on stdin; canonical normalized charts on stdout.
const paths = JSON.parse(readFileSync(0, "utf8"));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/inspector/package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const server = await createServer({
  root: repoRoot,
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "beatmap-lens": join(repoRoot, "packages/beatmap-lens/src/index.ts") } },
});
const charts = [];
const skipped = [];
try {
  const { inspectOsuSourceV1 } = await server.ssrLoadModule(
    "/apps/inspector/src/annotation/source-identity.ts",
  );
  for (const sourcePath of paths) {
    const bytes = await readFile(sourcePath);
    const { source, chart, parsed } = await inspectOsuSourceV1(bytes);
    if (chart.mode !== 3 || chart.keyCount !== 4) {
      skipped.push({ sourcePath, mode: chart.mode, keyCount: chart.keyCount });
      continue;
    }
    assert.equal(chart.diagnostics.length, 0, `Inspect diagnostics for ${sourcePath}`);
    const timingPoints = parsed.sections
      .filter((section) => section.name.toLowerCase() === "timingpoints")
      .flatMap((section) =>
        section.dataLines.map((line) => ({ sourceLine: line.number, fields: line.fields ?? [] })),
      );
    const general = (key) =>
      [...parsed.properties]
        .reverse()
        .find(
          (property) =>
            property.section.toLowerCase() === "general" && property.key.toLowerCase() === key,
        )?.value;
    charts.push({
      sourcePath,
      sourceMd5: createHash("md5").update(bytes).digest("hex"),
      audioFilename: general("audiofilename") ?? null,
      audioLeadInMs: Number(general("audioleadin") ?? 0),
      chart: { source, range: chart.range, notes: chart.notes, timingPoints },
    });
  }
} finally {
  await server.close();
}
process.stdout.write(`${JSON.stringify({ charts, skipped })}\n`);
