import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  compactReviewWorkspace,
  LocalDirectoryHandle,
} from "../../../apps/inspector/server/workflow-local-directory.mjs";
import { readCurrentHumanFeedback } from "../read-current-human-feedback.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(new URL("../../../apps/inspector/package.json", import.meta.url));
const workspace = resolve(process.argv[2]);
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const server = await createServer({
  root: repoRoot,
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "beatmap-lens": join(repoRoot, "packages/beatmap-lens/src/index.ts") } },
});
const originalGetFile = LocalDirectoryHandle.prototype.getFileHandle;
const checks = [];

try {
  const domain = await server.ssrLoadModule("/apps/inspector/src/annotation/workflow/domain.ts");
  const { workflowFixture, NOW } = await server.ssrLoadModule(
    "/apps/inspector/src/annotation/workflow/test-fixtures.ts",
  );
  const { serializeCanonicalJson } = await server.ssrLoadModule(
    "/apps/inspector/src/annotation/canonical-json.ts",
  );
  const fixture = await workflowFixture();
  const options = { humanId: "fixture-human", now: () => NOW };
  let document = await domain.addHumanObservationsV2(
    fixture.registered,
    {
      ...options,
      id: "first",
      claims: [fixture.claim],
      confidences: { [fixture.claim.id]: "high" },
    },
    fixture.sourceBytes,
  );
  document = await domain.addHumanObservationsV2(
    document,
    {
      ...options,
      id: "revision",
      claims: [fixture.claim],
      supersedesObservationId: `first:${fixture.claim.id}`,
      confidences: { [fixture.claim.id]: "low" },
    },
    fixture.sourceBytes,
  );
  document = await domain.addHumanObservationsV2(
    document,
    {
      ...options,
      id: "other",
      claims: [
        { ...fixture.claim, id: "current-high" },
        { ...fixture.claim, id: "unspecified" },
      ],
      confidences: { "current-high": "high" },
    },
    fixture.sourceBytes,
  );
  await mkdir(join(workspace, "workflow"), { recursive: true });
  const filename = `${document.source.sha256}.v2.json`;
  const file = join(workspace, "workflow", filename);
  await writeFile(file, serializeCanonicalJson(document));
  const before = await physicalSnapshot(workspace);
  const plain = await readCurrentHumanFeedback(workspace);
  assert.deepEqual(await physicalSnapshot(workspace), before);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].sourceSha256, document.source.sha256);
  assert.deepEqual(plain[0].documentVersion, await domain.reviewDocumentVersionV2(document));
  const observations = plain[0].effectiveHumanObservations;
  assert.deepEqual(
    observations.map((observation) => observation.id),
    [`revision:${fixture.claim.id}`, "other:current-high", "other:unspecified"],
  );
  assert.equal(observations[0].confidence, "low");
  assert.equal(observations[1].confidence, "high");
  assert.equal(Object.hasOwn(observations[2], "confidence"), false);
  checks.push("canonical-supersession");
  for (const observation of observations) {
    const canonical = document.observations.find((entry) => entry.id === observation.id);
    assert.deepEqual(observation.trust, { source: "current", foundation: "current" });
    assert.equal(observation.observationSha256, await domain.hashWorkflowValueV2(canonical));
    assert.deepEqual(observation.claim, canonical.claim);
    assert.equal(Object.hasOwn(observation, "origin"), false);
  }
  checks.push("observation-hashes");

  await compactReviewWorkspace(workspace);
  assert.equal(JSON.parse(await readFile(file, "utf8")).storage, "beatmap-lens-local-compact-v1");
  const packedBefore = await physicalSnapshot(workspace);
  assert.deepEqual(await readCurrentHumanFeedback(workspace), plain);
  assert.deepEqual(await physicalSnapshot(workspace), packedBefore);
  checks.push("packed-identity");
  const cli = await promisify(execFile)(
    process.execPath,
    [
      join(repoRoot, "annotation/evaluation/read-current-human-feedback.mjs"),
      "--workflow-dir",
      workspace,
    ],
    { cwd: workspace, timeout: 10_000 },
  );
  assert.deepEqual(JSON.parse(cli.stdout), plain);
  assert.equal(cli.stderr, "");
  checks.push("cli-json-outside-repository");
  assert.deepEqual(await physicalSnapshot(workspace), packedBefore);
  checks.push("read-only-workspace");

  // Change storage after its canonical read, before the helper's final snapshot.
  const packedBytes = await readFile(file);
  LocalDirectoryHandle.prototype.getFileHandle = async function (name, options) {
    const handle = await originalGetFile.call(this, name, options);
    if (name === filename) {
      const read = handle.readCanonicalJson.bind(handle);
      handle.readCanonicalJson = async () => {
        const value = await read();
        await writeFile(file, Buffer.concat([packedBytes, Buffer.from("\n")]));
        return value;
      };
    }
    return handle;
  };
  await assert.rejects(
    readCurrentHumanFeedback(workspace),
    /Workflow files changed during feedback snapshot/,
  );
  LocalDirectoryHandle.prototype.getFileHandle = originalGetFile;
  await writeFile(file, packedBytes);
  checks.push("concurrent-content-change");

  const additional = join(workspace, "workflow", `${"f".repeat(64)}.v2.json`);
  LocalDirectoryHandle.prototype.getFileHandle = async function (name, options) {
    const handle = await originalGetFile.call(this, name, options);
    await writeFile(additional, packedBytes);
    return handle;
  };
  await assert.rejects(
    readCurrentHumanFeedback(workspace),
    /Workflow files changed during feedback snapshot/,
  );
  LocalDirectoryHandle.prototype.getFileHandle = originalGetFile;
  await rm(additional);
  checks.push("concurrent-inventory-change");

  // The fixture's frozen task retains the observation's original Foundation.
  document = {
    ...document,
    foundation: { ...document.foundation, revision: document.foundation.revision + 1 },
  };
  await writeFile(file, serializeCanonicalJson(document));
  const drifted = await readCurrentHumanFeedback(workspace);
  assert.ok(
    drifted[0].effectiveHumanObservations.every(
      (observation) => observation.trust.foundation === "changed",
    ),
  );
  checks.push("foundation-drift");
  await rm(file);
  assert.deepEqual(await readCurrentHumanFeedback(workspace), []);
  checks.push("empty-workspace");
  process.stdout.write(`${JSON.stringify({ checks })}\n`);
} finally {
  LocalDirectoryHandle.prototype.getFileHandle = originalGetFile;
  await server.close();
}

async function physicalSnapshot(path) {
  const result = [];
  for (const name of (await readdir(path)).sort()) {
    const file = join(path, name);
    const info = await stat(file);
    result.push(
      info.isDirectory()
        ? [name, await physicalSnapshot(file)]
        : [
            name,
            info.mtimeMs,
            createHash("sha256")
              .update(await readFile(file))
              .digest("hex"),
          ],
    );
  }
  return result;
}
