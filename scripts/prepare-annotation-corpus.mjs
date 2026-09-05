import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    selection: { type: "string" },
    out: { type: "string" },
    python: { type: "string", default: "python3" },
    "max-duration-ms": { type: "string", default: "2400000" },
  },
});
if (!values.selection || !values.out) {
  throw new Error("Use --selection ADMIN_SELECTION.json --out DIRECTORY --python PYARROW_PYTHON");
}
const maximumDurationMs = Number(values["max-duration-ms"]);
assert.ok(Number.isFinite(maximumDurationMs) && maximumDurationMs > 0);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(values.out);
const admin = join(destination, "admin");
await mkdir(admin, { recursive: true });
const selected = JSON.parse(await readFile(resolve(values.selection), "utf8"));
const require = createRequire(join(repoRoot, "apps/inspector/package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const server = await createServer({
  root: repoRoot,
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "beatmap-lens": join(repoRoot, "packages/beatmap-lens/src/index.ts") } },
});
const normalizedPath = join(admin, "normalized.jsonl");
const normalized = await open(normalizedPath, "w");
const sources = [];
try {
  const { inspectOsuSourceV1 } = await server.ssrLoadModule(
    "/apps/inspector/src/annotation/source-identity.ts",
  );
  for (const row of selected.candidates) {
    const bytes = await readFile(row.sourcePath);
    const { source, chart, parsed } = await inspectOsuSourceV1(bytes);
    assert.equal(source.beatmapId, Number(row.beatmapId));
    assert.equal(chart.keyCount, 4);
    assert.equal(chart.mode, 3);
    assert.equal(chart.diagnostics.length, 0, `Inspect diagnostics for ${source.sha256}`);
    const durationMs = chart.range.endMs - chart.range.startMs;
    assert.ok(durationMs <= maximumDurationMs, `Chart exceeds assignment cap: ${source.sha256}`);
    const sourceChecksumMd5 = createHash("md5").update(bytes).digest("hex");
    const timingPoints = parsed.sections
      .filter((section) => section.name.toLowerCase() === "timingpoints")
      .flatMap((section) =>
        section.dataLines.map((line) => ({ sourceLine: line.number, fields: line.fields ?? [] })),
      );
    const facts = { source, range: chart.range, durationMs, notes: chart.notes, timingPoints };
    await normalized.write(`${JSON.stringify(facts)}\n`);
    sources.push({
      source,
      sourcePath: row.sourcePath,
      range: chart.range,
      durationMs,
      sourceChecksumMd5,
      metadataChecksumMd5: row.metadataChecksumMd5,
      matchesMetadataChecksum: sourceChecksumMd5 === row.metadataChecksumMd5,
    });
  }
} finally {
  await normalized.close();
  await server.close();
}
await writeFile(join(admin, "source-map.json"), `${JSON.stringify(sources, null, 2)}\n`);
const conversion = spawnSync(
  values.python,
  [
    join(repoRoot, "scripts/prepare-annotation-corpus.py"),
    "--normalized",
    normalizedPath,
    "--out",
    destination,
    "--max-duration-ms",
    String(maximumDurationMs),
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);
if (conversion.error) throw conversion.error;
if (conversion.stdout) process.stdout.write(conversion.stdout);
if (conversion.stderr) process.stderr.write(conversion.stderr);
if (conversion.status !== 0) process.exitCode = conversion.status ?? 1;
