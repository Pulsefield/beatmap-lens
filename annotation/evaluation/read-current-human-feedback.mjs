import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LocalDirectoryHandle } from "../../apps/inspector/server/workflow-local-directory.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../apps/inspector/package.json", import.meta.url));

/** Read current canonical human feedback without changing the workspace. */
export async function readCurrentHumanFeedback(workspace) {
  const workflowPath = join(resolve(workspace), "workflow");
  const before = await snapshotWorkflowFiles(workflowPath);
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "beatmap-lens": join(repoRoot, "packages/beatmap-lens/src/index.ts") } },
  });

  try {
    const domain = await server.ssrLoadModule("/apps/inspector/src/annotation/workflow/domain.ts");
    const { WorkflowDirectoryV2 } = await server.ssrLoadModule(
      "/apps/inspector/src/annotation/workflow/directory.ts",
    );
    const directory = new WorkflowDirectoryV2(new LocalDirectoryHandle(workspace));
    const feedback = [];
    for (const { name } of before) {
      const sourceSha256 = name.slice(0, -".v2.json".length);
      const stored = await directory.read(sourceSha256);
      if (!stored) throw new Error(`Workflow file disappeared during feedback snapshot: ${name}`);
      const foundationSha256 = await domain.hashWorkflowValueV2(stored.document.foundation);
      const effectiveHumanObservations = [];
      for (const observation of domain.effectiveHumanObservationsV2(stored.document)) {
        effectiveHumanObservations.push({
          id: observation.id,
          ...(observation.confidence === undefined ? {} : { confidence: observation.confidence }),
          foundationSha256: observation.foundationSha256,
          humanId: observation.humanId,
          confirmedAt: observation.confirmedAt,
          claim: observation.claim,
          observationSha256: await domain.hashWorkflowValueV2(observation),
          trust: {
            source: "current",
            foundation: observation.foundationSha256 === foundationSha256 ? "current" : "changed",
          },
        });
      }
      feedback.push({ sourceSha256, documentVersion: stored.version, effectiveHumanObservations });
    }
    const after = await snapshotWorkflowFiles(workflowPath);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(
        "Workflow files changed during feedback snapshot. Retry against a stable workspace.",
      );
    }
    return feedback;
  } finally {
    await server.close();
  }
}

async function snapshotWorkflowFiles(workflowPath) {
  const names = (await readdir(workflowPath)).filter((name) => name.endsWith(".v2.json")).sort();
  const files = [];
  for (const name of names) {
    const bytes = await readFile(join(workflowPath, name));
    files.push({ name, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        "workflow-dir": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      process.stdout.write(
        "Usage: node annotation/evaluation/read-current-human-feedback.mjs --workflow-dir WORKSPACE_ROOT\n",
      );
    } else {
      if (!values["workflow-dir"]) throw new Error("--workflow-dir WORKSPACE_ROOT is required.");
      process.stdout.write(
        `${JSON.stringify(await readCurrentHumanFeedback(values["workflow-dir"]))}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
