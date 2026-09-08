import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { hashWorkflowValueV2 } from "./domain";
import { workflowFixture } from "./test-fixtures";

const exec = promisify(execFile);
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const script = resolve("annotation/pipeline/prepare-annotation-recovery.py");

async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
}

async function json(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

it("validates original task transport and preserves Chinese calibration across repeated stdin buffer boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "unicode-recovery-"));
  try {
    const f = await workflowFixture();
    const foundation = {
      ...f.task.foundation,
      calibrationExamples: f.task.foundation.calibrationExamples.map((example) => ({
        ...example,
        explanation: "原始人工校准说明，完整保留来源与判断。🎵".repeat(8000),
      })),
    };
    const { taskSha256: _, ...originalBody } = f.task;
    const body = {
      ...originalBody,
      foundation,
      foundationSha256: await hashWorkflowValueV2(foundation),
    };
    const task = { ...body, taskSha256: await hashWorkflowValueV2(body) };
    const path = join(root, "frozen-task.json.gz");
    await writeFile(path, gzipSync(JSON.stringify(task)));
    const program = `
import gzip, importlib.util, json, pathlib, sys
spec = importlib.util.spec_from_file_location('recovery', pathlib.Path('annotation/pipeline/prepare-annotation-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
task = json.loads(gzip.decompress(pathlib.Path(sys.argv[1]).read_bytes()))
print(json.dumps({'binding': recovery.validate_frozen_task(sys.argv[1]),
                  'hashes': recovery.revision.canonical_hashes([task['foundation']] * 3)}))
`;
    const result = JSON.parse(
      (
        await exec("python3", ["-c", program, path], {
          cwd: resolve("."),
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        })
      ).stdout,
    );
    expect(result.binding).toEqual({
      sourceSha256: task.source.sha256,
      taskId: task.taskId,
      taskSha256: task.taskSha256,
      foundationSha256: task.foundationSha256,
      base: task.base,
    });
    expect(result.hashes).toEqual(Array(3).fill(task.foundationSha256));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("recovers an unsubmitted failure with exact inputs and no fabricated supersession, refusing stale bases and partial delivery", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "annotation-recovery-")));
  const f = await workflowFixture();
  const id = "0123456789abcdefabcd";
  const sha = f.inspected.source.sha256;
  const producerId = "failed-fixture-labeler";
  const job = join(root, "workers", `${id}-labeler`);
  const common = join(root, "worker-common-repair");
  const requests: string[] = [];
  const feedback = {
    contract: "beatmap-lens-agent-feedback",
    version: 2,
    sourceSha256: sha,
    reviewBase: f.task.base,
    taskBinding: {
      taskId: f.task.taskId,
      taskSha256: f.task.taskSha256,
      foundationSha256: f.task.foundationSha256,
      base: f.task.base,
    },
    handoffs: [] as Array<{ agent: { producerId: string } }>,
  };
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(feedback));
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
    const skillText = Buffer.from("Frozen fixture skill\n");
    const manifest = Buffer.from(
      JSON.stringify({ files: [{ path: "SKILL.md", sha256: hash(skillText) }] }),
    );
    const skill = { name: "fixture-skill", version: "frozen-1", sha256: hash(manifest) };
    const foundation = { foundationSha256: f.task.foundationSha256, tags: f.task.foundation.tags };
    for (const directory of [job, common]) {
      await save(join(directory, "skill/manifest.json"), manifest);
      await save(join(directory, "skill/SKILL.md"), skillText);
      await save(join(directory, "foundation.json"), foundation);
    }
    // A corrected role/helper snapshot is allowed while source, Foundation and skill stay pinned.
    await save(join(common, "roles/labeler.md"), Buffer.from("Corrected output instructions\n"));
    await save(join(job, "ROLE.md"), Buffer.from("Original output instructions\n"));
    const parquet = Buffer.from("Frozen chart transport fixture");
    const chart = {
      sourceSha256: sha,
      parquetPath: join(job, "charts", `${sha}.parquet`),
      parquetSha256: hash(parquet),
      durationMs: f.task.structure.range.endMs,
      noteCount: f.task.source.noteCount,
    };
    await save(chart.parquetPath, parquet);
    const assignment = {
      assignmentId: id,
      kind: "beatmap-lens-blind-chart-assignment-v1",
      durationMs: chart.durationMs,
      maximumDurationMs: 2400000,
      charts: [chart],
    };
    await save(join(job, "assignment.json"), assignment);
    await save(join(job, "bindings.json"), [{ sourceSha256: sha, ...feedback.taskBinding }]);
    const originalResult = {
      skill,
      charts: [{ sourceSha256: sha, claims: [], unresolved: "Incomplete output fixture" }],
    };
    await save(join(job, "result.json"), originalResult);
    const inputNames = ["assignment.json", "bindings.json", "foundation.json", "ROLE.md"];
    const originalFiles = new Map(
      await Promise.all(
        [...inputNames, "result.json"].map(
          async (name) => [name, await readFile(join(job, name))] as const,
        ),
      ),
    );
    const run = {
      assignmentId: id,
      producerId,
      role: "labeler",
      status: "acceptance-failed",
      exitCode: 0,
      skill,
      requestedModel: "gpt-5.4-mini",
      requestedReasoningEffort: "high",
      inputHashes: Object.fromEntries(
        await Promise.all(
          inputNames.map(async (name) => [name, hash(await readFile(join(job, name)))]),
        ),
      ),
      resultSha256: hash(await readFile(join(job, "result.json"))),
    };
    await save(join(job, "run.json"), run);
    originalFiles.set("run.json", await readFile(join(job, "run.json")));
    await save(join(root, "controller/config.json"), {
      server: `http://127.0.0.1:${address.port}`,
      skill,
      foundationSha256: f.task.foundationSha256,
      maxDurationMs: 2400000,
      workerCommonPath: "worker-common-repair",
      models: { labeler: run.requestedModel },
      reasoningEfforts: { labeler: run.requestedReasoningEffort },
    });
    const compressed = gzipSync(JSON.stringify(f.task));
    await save(join(root, "controller/tasks", `${id}-${sha}.json.gz`), compressed);
    const diagnostics = {
      findings: [
        {
          sourceSha256: sha,
          code: "incomplete-claims",
          message: "Review the omitted source-backed claims.",
        },
      ],
    };
    const findings = join(root, "findings.json");
    await save(findings, diagnostics);
    const args = [script, "--campaign", root, "--assignment-id", id, "--findings-file", findings];
    const options = { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } };
    const prepared = JSON.parse((await exec("python3", args, options)).stdout);
    expect(prepared.assignmentId).toMatch(/^[a-f0-9]{20}$/);
    expect(prepared.assignmentId).not.toBe(id);
    expect(prepared).toMatchObject({
      revisionOf: id,
      supersedes: [],
      status: "prepared-not-run",
      chartCount: 1,
    });
    const revised = await json(prepared.assignmentPath);
    expect(revised.charts).toEqual(assignment.charts);
    expect(revised.durationMs).toBe(assignment.durationMs);
    expect(revised.supersedes).toEqual([]);
    const prior = await json(prepared.priorReviewPath);
    expect(prior.originalRun).toEqual(run);
    expect(prior.originalResult).toEqual(originalResult);
    expect(prior.originalResultSha256).toBe(run.resultSha256);
    expect(prior.diagnostics).toEqual(diagnostics);
    expect(prior.workerCommonPath).toBe(common);
    expect(prior.workerCommonHashes["roles/labeler.md"]).toBe(
      hash(await readFile(join(common, "roles/labeler.md"))),
    );
    expect(prior.supersedes).toEqual([]);
    expect(prior.charts[0].handoff).toBeUndefined();
    expect(prior.charts[0].audit).toBeUndefined();
    expect(
      await readFile(join(root, "controller/tasks", `${prepared.assignmentId}-${sha}.json.gz`)),
    ).toEqual(compressed);
    expect(await readFile(join(dirname(prepared.priorReviewPath), "original-result.json"))).toEqual(
      originalFiles.get("result.json"),
    );
    expect(prior.modelChange).toBeUndefined();

    const configPath = join(root, "controller/config.json");
    const originalConfig = await json(configPath);
    const updatedConfig = { ...originalConfig, models: { labeler: "gpt-6-astra" } };
    await save(configPath, updatedConfig);
    await expect(exec("python3", args, options)).rejects.toMatchObject({
      stderr: expect.stringContaining("--model-change-reason"),
    });
    await expect(
      exec("python3", [...args, "--model-change-reason", "  "], options),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("nonempty explicit authorization"),
    });
    const reason = "User explicitly requested gpt-6-astra labelers for the fresh recovery.";
    const changed = JSON.parse(
      (await exec("python3", [...args, "--model-change-reason", reason], options)).stdout,
    );
    const changedPrior = await json(changed.priorReviewPath);
    expect(changedPrior.modelChange).toEqual({
      original: { requestedModel: "gpt-5.4-mini", requestedReasoningEffort: "high" },
      current: { requestedModel: "gpt-6-astra", requestedReasoningEffort: "high" },
      reason,
    });
    expect(changed.modelChange).toEqual(changedPrior.modelChange);
    expect(changedPrior.originalRun).toEqual(run);
    expect(changedPrior.originalResultSha256).toBe(run.resultSha256);
    expect(changedPrior.supersedes).toEqual([]);
    expect(
      await readFile(join(root, "controller/tasks", `${changed.assignmentId}-${sha}.json.gz`)),
    ).toEqual(compressed);
    await save(configPath, originalConfig);

    feedback.reviewBase = { ...f.task.base, revision: f.task.base.revision + 1 };
    await expect(exec("python3", args, options)).rejects.toMatchObject({
      stderr: expect.stringContaining("review base changed"),
    });
    feedback.reviewBase = f.task.base;
    feedback.handoffs = [{ agent: { producerId } }];
    await expect(exec("python3", args, options)).rejects.toMatchObject({
      stderr: expect.stringContaining("already delivered"),
    });
    feedback.handoffs = [];
    await save(join(job, "packets", `${sha}.json`), { handoffId: "partial-delivery" });
    await expect(exec("python3", args, options)).rejects.toMatchObject({
      stderr: expect.stringContaining("reviewed revision path"),
    });
    expect((await readdir(join(root, "controller/revisions"))).sort()).toEqual(
      [`${prepared.assignmentId}.json`, `${changed.assignmentId}.json`].sort(),
    );
    expect(await readdir(join(root, "workers"))).toEqual([`${id}-labeler`]);
    expect(requests).toEqual(Array(4).fill(`GET /api/review/feedback/${sha}`));
    for (const [name, bytes] of originalFiles)
      expect(await readFile(join(job, name))).toEqual(bytes);
    expect(await readFile(join(root, "controller/tasks", `${id}-${sha}.json.gz`))).toEqual(
      compressed,
    );
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
