import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { atomicWrite, readCanonicalWorkflowFile } from "./workflow-local-directory.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const workflowName = /^[a-f\d]{64}\.v2\.json$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Hash the physical inventory before/after reading, including immutable source/Foundation blobs. */
async function inputInventory(workspace) {
  const inventory = new Map();
  for (const directory of ["workflow", ".workflow-objects"]) {
    const names = await readdir(join(workspace, directory)).catch((error) => {
      if (directory === ".workflow-objects" && error.code === "ENOENT") return [];
      throw error;
    });
    for (const name of names.sort()) {
      if (directory === "workflow" && !workflowName.test(name)) continue;
      if (directory === ".workflow-objects" && !/^[a-f\d]{64}\.(bin|json\.gz)$/.test(name))
        continue;
      const key = `${directory}/${name}`;
      inventory.set(key, digest(await readFile(join(workspace, key))));
    }
  }
  return inventory;
}

/** Only implementation bytes belong here; semantic artifacts have their own references. */
async function collectorInventory() {
  const names = [
    "apps/inspector/server/collect-annotation-release.mjs",
    "apps/inspector/server/workflow-local-directory.mjs",
    "apps/inspector/package.json",
    "package.json",
    "pnpm-lock.yaml",
  ];
  const visit = async (directory) => {
    for (const entry of await readdir(join(repo, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory() && !["tests", "__tests__"].includes(entry.name)) await visit(path);
      if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !/\.(test|spec|bench)\.ts$/.test(entry.name) &&
        !entry.name.startsWith("test-")
      )
        names.push(path);
    }
  };
  await visit("apps/inspector/src/annotation");
  await visit("packages/beatmap-lens/src");
  const inventory = new Map();
  for (const name of names.sort()) inventory.set(name, digest(await readFile(join(repo, name))));
  return inventory;
}

function sameInventory(before, after) {
  return before.size === after.size && [...before].every(([key, sha]) => after.get(key) === sha);
}

/** Offline, read-only collection; no service state, workspace mutation, or annotation replay. */
export async function collectAnnotationRelease(options) {
  const workspace = resolve(options.workspace);
  const collectorFiles = await collectorInventory();
  const before = await inputInventory(workspace);
  const files = [...before.keys()].filter((key) => key.startsWith("workflow/"));
  if (!files.length) throw new Error("Workspace contains no V2 review documents.");
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const vite = await createServer({
    root: repo,
    configFile: false,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "beatmap-lens": join(repo, "packages/beatmap-lens/src/index.ts") } },
  });
  try {
    const { projectReviewForPublicationV1, assemblePublicationInputV1 } = await vite.ssrLoadModule(
      "/apps/inspector/src/annotation/workflow/publication.ts",
    );
    const projections = [];
    const workspaceFiles = [];
    for (const key of files) {
      const content = await readCanonicalWorkflowFile(join(workspace, key));
      const sourceSha256 = key.slice("workflow/".length, -".v2.json".length);
      const projection = await projectReviewForPublicationV1(JSON.parse(content));
      if (projection.source.sha256 !== sourceSha256)
        throw new Error(
          `Workflow filename differs from its exact source identity: ${sourceSha256}`,
        );
      projections.push(projection);
      workspaceFiles.push({ source_sha256: sourceSha256, canonical_sha256: digest(content) });
      await options.onProgress?.({
        completed: projections.length,
        total: files.length,
        sourceSha256,
      });
    }
    const after = await inputInventory(workspace);
    if (!sameInventory(before, after))
      throw new Error("Workspace changed during release collection. Retry from a stable snapshot.");
    if (!sameInventory(collectorFiles, await collectorInventory()))
      throw new Error(
        "Collector implementation changed during release collection. Retry with stable source files.",
      );
    return assemblePublicationInputV1(projections, {
      createdAt: options.createdAt ?? new Date().toISOString(),
      sourceShas: options.sourceShas,
      workspaceFiles,
      collectorFiles: Object.fromEntries(collectorFiles),
    });
  } finally {
    await vite.close();
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
    options: {
      workspace: { type: "string" },
      out: { type: "string" },
      "source-sha": { type: "string", multiple: true },
      "created-at": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Collect a read-only V2 workspace projection for the dataset release pipeline.\n\n  node apps/inspector/server/collect-annotation-release.mjs --workspace DIR --out FILE [--source-sha SHA ...] [--created-at ISO]\n\nThe output is an internal staging file, not a publishable dataset. All workspace\ndependencies are frozen and checked even when selecting particular source hashes.\n",
    );
    return;
  }
  if (!values.workspace || !values.out) throw new Error("--workspace and --out are required.");
  const workspace = resolve(values.workspace);
  const output = resolve(values.out);
  for (const name of ["workflow", ".workflow-objects"])
    if (output.startsWith(`${join(workspace, name)}${sep}`))
      throw new Error("Release output must not overwrite canonical workspace inputs.");
  const result = await collectAnnotationRelease({
    workspace,
    sourceShas: values["source-sha"],
    createdAt: values["created-at"],
    onProgress: ({ completed, total }) => {
      if (completed % 25 === 0 || completed === total)
        process.stderr.write(`Collected ${completed}/${total} frozen source documents.\n`);
    },
  });
  await mkdir(dirname(output), { recursive: true });
  await atomicWrite(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, sources: result.sources.length, human: result.human.length, agents: result.agents.length })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
