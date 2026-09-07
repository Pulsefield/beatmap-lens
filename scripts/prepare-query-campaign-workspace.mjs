import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LocalDirectoryHandle } from "./workflow-local-directory.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/inspector/package.json", import.meta.url));
const selections = [
  {
    sourceSha256: "901aaaa859e3493de3db4e8516c93c47e707fc1d757fe1d582c397d2e86f245f",
    observationId: "738aa6e1-6e82-4ff7-aa27-0c899eaf7b2a:observation",
    tagId: "ln-coordination",
    assessment: { presence: "present", salience: "prominent" },
  },
  {
    sourceSha256: "d32789577cfde27c2d055eb69106a570485bab94b3dd60de25ff8b0503584a4d",
    observationId: "00b0c9e0-3cf3-4485-bfcb-c2f611b03411:observation",
    tagId: "stream-organization",
    assessment: { presence: "present", salience: "supporting" },
  },
  {
    sourceSha256: "8f01f79e3bed9e2d28b223b610fb59f91d07807b0f4ab534a0805375178552d5",
    observationId: "bb1a796d-1058-4e64-9d9d-7c965390d5b0:observation",
    tagId: "stream-organization",
    assessment: { presence: "absent" },
  },
  {
    sourceSha256: "e613eacc59db702a0f86d35b355f9c1071db6329e835241e4be2cbae6ad81742",
    observationId: "e58c0257-9ab6-4a25-b3e1-d875f84771c5:observation",
    tagId: "jack-organization",
    assessment: { presence: "present", salience: "prominent" },
  },
  {
    sourceSha256: "bbdb957a74b163703e385f9211a6acaba137871ec5175974ce2d421e0d5dac14",
    observationId: "clarification-17f86a3715624367b4b665dd95dd7a1f:c14-03-tech",
    tagId: "tech",
    assessment: { presence: "present", salience: "supporting" },
  },
];

async function withRuntime(operation) {
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const vite = await createServer({
    root: repo,
    configFile: false,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "beatmap-lens": join(repo, "packages/beatmap-lens/src/index.ts") } },
  });
  try {
    const domain = await vite.ssrLoadModule("/apps/inspector/src/annotation/workflow/domain.ts");
    const { WorkflowDirectoryV2 } = await vite.ssrLoadModule(
      "/apps/inspector/src/annotation/workflow/directory.ts",
    );
    const { createQueryPilotFoundationV2 } = await vite.ssrLoadModule(
      "/apps/inspector/src/annotation/workflow/query-campaign.ts",
    );
    return await operation({ domain, WorkflowDirectoryV2, createQueryPilotFoundationV2 });
  } finally {
    await vite.close();
  }
}

function outsideArchive(oldWorkspace, target) {
  const path = relative(resolve(oldWorkspace), resolve(target));
  if (!path.startsWith("../") && path !== "..")
    throw new Error("The new workspace and artifacts must be outside the historical workspace.");
}

/** Prepare evidence only. This function never writes either canonical workspace. */
export async function prepareQueryCampaign(options) {
  const oldWorkspace = resolve(options.oldWorkspace);
  const workspace = resolve(options.workspace);
  outsideArchive(oldWorkspace, workspace);
  return withRuntime(async ({ domain, WorkflowDirectoryV2, createQueryPilotFoundationV2 }) => {
    const old = new WorkflowDirectoryV2(new LocalDirectoryHandle(oldWorkspace));
    const foundation = createQueryPilotFoundationV2(options.createdAt ?? new Date().toISOString());
    const calibrationExamples = [];
    const provenance = [];
    for (const selected of options.selections ?? selections) {
      const stored = await old.read(selected.sourceSha256);
      const document = stored?.document;
      const observation = document?.observations.find(
        (entry) => entry.id === selected.observationId,
      );
      const task = document?.tasks.at(-1);
      if (!observation || !task)
        throw new Error(`Missing recorded calibration ${selected.observationId}.`);
      if (
        observation.claim.tagId !== selected.tagId ||
        (await domain.hashWorkflowValueV2(observation.claim.assessment)) !==
          (await domain.hashWorkflowValueV2(selected.assessment))
      )
        throw new Error(`The selected human assessment differs: ${selected.observationId}.`);
      const decision =
        observation.origin.kind === "agent-proposal"
          ? document.decisions.find((entry) => entry.id === observation.origin.decisionId)
          : undefined;
      const exampleId = `prior-human:${observation.id}`;
      calibrationExamples.push({
        id: exampleId,
        source: document.source,
        sourceBytes: task.sourceBytes,
        claim: observation.claim,
        explanation: `Prior human observation ${observation.id}, confirmed by ${observation.humanId} at ${observation.confirmedAt}, under Foundation SHA-256 ${observation.foundationSha256}. The saved human assessment is ${JSON.stringify(observation.claim.assessment)}. Original evidence and rationale are retained verbatim, including any earlier machine uncertainty; that earlier uncertainty does not override the saved human assessment. ${decision ? `Human decision rationale: ${decision.rationale}. ` : ""}The preparation provenance retains the complete original observation and decision. Reuse as calibration creates no new human observation.`,
      });
      provenance.push({
        exampleId,
        sourceSha256: selected.sourceSha256,
        documentId: document.documentId,
        documentVersion: stored.version,
        originalTaskSha256: task.taskSha256,
        observation,
        ...(decision ? { decision } : {}),
      });
    }
    const prepared = await domain.assertFoundationV2({ ...foundation, calibrationExamples });
    return {
      contract: "beatmap-lens-query-campaign-preparation",
      version: 1,
      oldWorkspace,
      workspace,
      seedSourceSha256: provenance[0].sourceSha256,
      foundation: prepared,
      provenance,
    };
  });
}

/** Explicit approval of the already reviewed bytes; original human records are never copied. */
export async function approvePreparedQueryCampaign(options) {
  if (!options.humanId?.trim() || !options.authorization?.trim())
    throw new Error("Explicit human identity and approval authorization are required.");
  const content = await readFile(options.prepared);
  if (digest(content) !== options.preparedSha256)
    throw new Error("Prepared artifact hash differs from the reviewed SHA-256.");
  const prepared = JSON.parse(content.toString("utf8"));
  outsideArchive(prepared.oldWorkspace, prepared.workspace);
  return withRuntime(async ({ domain, WorkflowDirectoryV2 }) => {
    const foundation = await domain.assertFoundationV2(prepared.foundation);
    if (foundation.approval.status !== "proposed")
      throw new Error("Approval requires the reviewed proposed Foundation.");
    const seed = foundation.calibrationExamples.find(
      (example) => example.source.sha256 === prepared.seedSourceSha256,
    );
    if (!seed) throw new Error("Prepared seed source is missing.");
    const sourceBytes = Uint8Array.from(seed.sourceBytes);
    const directory = new WorkflowDirectoryV2(new LocalDirectoryHandle(prepared.workspace));
    let stored = await directory.initialize(sourceBytes, foundation);
    if (
      (await domain.hashWorkflowValueV2({
        ...stored.document.foundation,
        approval: { status: "proposed" },
      })) !== (await domain.hashWorkflowValueV2(foundation))
    )
      throw new Error("The target workspace already uses a different Foundation.");
    stored = await directory.approveFoundation(sourceBytes, stored.version, options.humanId);
    let task = stored.document.tasks.at(-1);
    if (!task) ({ stored, task } = await directory.exportTask(sourceBytes, stored.version));
    const receipt = {
      workspace: prepared.workspace,
      preparedFile: resolve(options.prepared),
      preparedSha256: options.preparedSha256,
      authorization: options.authorization,
      foundationSourceSha256: task.source.sha256,
      foundationSha256: await domain.hashWorkflowValueV2(stored.document.foundation),
      approval: stored.document.foundation.approval,
      documentVersion: stored.version,
      taskId: task.taskId,
      taskSha256: task.taskSha256,
      calibrationObservationIds: prepared.provenance.map((entry) => entry.observation.id),
    };
    await writeFile(join(prepared.workspace, "bootstrap.receipt.json"), json(receipt));
    return receipt;
  });
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function main() {
  const { values } = parseArgs({
    options: {
      "old-workspace": { type: "string" },
      workspace: { type: "string" },
      out: { type: "string" },
      approve: { type: "boolean" },
      prepared: { type: "string" },
      "prepared-sha": { type: "string" },
      "human-id": { type: "string" },
      authorization: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Prepare a proposed Foundation without canonical writes:\n  node scripts/prepare-query-campaign-workspace.mjs --old-workspace OLD --workspace NEW --out PREPARED.json\n\nApprove the reviewed artifact and register its first task (no workers or services):\n  node scripts/prepare-query-campaign-workspace.mjs --approve --prepared PREPARED.json --prepared-sha SHA --human-id ID --authorization TEXT\n",
    );
    return;
  }
  if (values.approve) {
    if (!values.prepared || !values["prepared-sha"])
      throw new Error("--approve requires --prepared and --prepared-sha.");
    process.stdout.write(
      json(
        await approvePreparedQueryCampaign({
          prepared: values.prepared,
          preparedSha256: values["prepared-sha"],
          humanId: values["human-id"],
          authorization: values.authorization,
        }),
      ),
    );
    return;
  }
  if (!values["old-workspace"] || !values.workspace || !values.out)
    throw new Error("Preparation requires --old-workspace, --workspace and --out.");
  outsideArchive(values["old-workspace"], values.out);
  const prepared = await prepareQueryCampaign({
    oldWorkspace: values["old-workspace"],
    workspace: values.workspace,
  });
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  const content = json(prepared);
  await writeFile(values.out, content, { flag: "wx" });
  process.stdout.write(
    json({
      preparedFile: resolve(values.out),
      preparedSha256: digest(content),
      workspace: prepared.workspace,
      foundationId: prepared.foundation.foundationId,
      approval: prepared.foundation.approval,
      examples: prepared.foundation.calibrationExamples.map((entry) => ({
        id: entry.id,
        sourceSha256: entry.source.sha256,
        tagId: entry.claim.tagId,
        scope: entry.claim.scope,
        assessment: entry.claim.assessment,
      })),
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
