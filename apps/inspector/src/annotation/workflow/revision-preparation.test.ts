import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  addHumanObservationsV2,
  baseForTaskV2,
  createTaskPacketV2,
  decideClaimV2,
  hashWorkflowValueV2,
  importAuditV2,
  importHandoffV2,
  sealAuditV2,
  sealHandoffV2,
} from "./domain";
import { workflowFixture } from "./test-fixtures";

const exec = promisify(execFile);
const script = resolve("scripts/prepare-annotation-revision.py");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
}
async function json(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fixture(outcome: "supported" | "needs-revision") {
  const f = await workflowFixture();
  const root = await mkdtemp(join(tmpdir(), "revision-preparation-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const id = "0123456789abcdefabcd";
  const sha = f.inspected.source.sha256;
  const label = join(root, "workers", `${id}-labeler`);
  const auditor = join(root, "workers", `${id}-auditor`);
  const handoff = await sealHandoffV2(f.task, {
    handoffId: "revision-original-handoff",
    createdAt: f.handoff.createdAt,
    agent: { role: "labeler", producerId: "revision-fixture-labeler" },
    proposals: [f.claim],
    questions: [],
    audit: [],
  });
  const audit = await sealAuditV2(f.task, handoff, {
    auditId: "revision-original-audit",
    createdAt: handoff.createdAt,
    agent: { role: "auditor", producerId: "revision-fixture-auditor" },
    claims: [{ claimId: f.claim.id, outcome, rationale: "Synthetic fixture audit finding." }],
    questions: [],
  });
  const imported = await importHandoffV2(f.registered, handoff, f.sourceBytes);
  const reviewed = (await importAuditV2(imported.document, audit, f.sourceBytes)).document;
  const rejected = await decideClaimV2(
    reviewed,
    {
      handoffId: handoff.handoffId,
      claimId: f.claim.id,
      humanId: "fixture-expert",
      disposition: "rejected",
      rationale: "Fixture expert: this alternation does not establish the proposed Tech judgment.",
    },
    f.sourceBytes,
  );
  const decision = rejected.decisions.at(-1);
  const confirmed = await addHumanObservationsV2(
    rejected,
    {
      humanId: "fixture-expert",
      claims: [
        {
          id: "direct-expert-tech",
          sectionId: "direct-expert-section",
          tagId: "tech",
          scope: f.claim.scope,
          reviewContext: f.claim.reviewContext,
          assessment: { presence: "present", salience: "supporting" },
          evidence: f.claim.evidence,
        },
      ],
    },
    f.sourceBytes,
  );
  const task = await createTaskPacketV2(confirmed, f.sourceBytes, {
    taskId: "revision-current-task",
  });
  const handoffSha256 = await hashWorkflowValueV2(handoff);
  const auditSha256 = await hashWorkflowValueV2(audit);
  const originalFeedback = {
    sourceSha256: sha,
    reviewBase: await baseForTaskV2(reviewed),
    handoffs: [{ handoffId: handoff.handoffId, handoffSha256 }],
    audits: [{ auditId: audit.auditId, auditSha256 }],
    directObservations: [],
    agentReviews: [
      {
        handoffId: handoff.handoffId,
        claimId: f.claim.id,
        status: outcome === "supported" ? "agent-reviewed" : "needs-revision",
        summary: f.claim,
      },
    ],
  };
  const currentFeedback = {
    ...originalFeedback,
    reviewBase: task.base,
    directObservations: confirmed.observations.map(({ claim, ...provenance }) => {
      const { evidence, ...summary } = claim;
      return {
        ...provenance,
        summary: {
          ...summary,
          rationale: evidence.rationale,
          witnessCount: evidence.noteRefs.length,
          contextNoteCount: evidence.contextNoteRefs.length,
        },
      };
    }),
    agentReviews: [
      {
        handoffId: handoff.handoffId,
        claimId: f.claim.id,
        status: "rejected",
        summary: f.claim,
        decision,
      },
    ],
  };
  const skill = { name: "fixture-skill", version: "frozen-1", sha256: "a".repeat(64) };
  // Preparation checks this transport's content hash; chart parsing belongs to corpus preparation.
  const parquet = Buffer.from("immutable chart transport fixture");
  const chart = {
    sourceSha256: sha,
    parquetPath: join(label, "charts", `${sha}.parquet`),
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
  const binding = {
    sourceSha256: sha,
    taskId: f.task.taskId,
    taskSha256: f.task.taskSha256,
    foundationSha256: f.task.foundationSha256,
    base: f.task.base,
    existingReviews: [],
  };
  const labelResult = {
    skill,
    charts: [
      {
        sourceSha256: sha,
        inspectedRanges: [f.task.structure.range],
        discoverySummary: "Fixture full-chart discovery.",
        claims: handoff.proposals,
        questions: [],
      },
    ],
  };
  const auditResult = {
    skill,
    charts: [
      {
        sourceSha256: sha,
        coverageReview: { outcome: "supported", rationale: "Fixture coverage inspected." },
        claims: audit.claims,
        questions: audit.questions,
      },
    ],
  };
  for (const [role, path, packet] of [
    ["labeler", label, handoff],
    ["auditor", auditor, audit],
  ] as const) {
    await save(join(path, "assignment.json"), assignment);
    await save(join(path, "run.json"), {
      status: "submitted",
      role,
      assignmentId: id,
      producerId: packet.agent.producerId,
      skill,
    });
    await save(join(path, "packets", `${sha}.json`), packet);
  }
  await save(join(label, "bindings.json"), [binding]);
  await save(join(label, "result.json"), labelResult);
  await save(join(auditor, "result.json"), auditResult);
  await save(join(auditor, "handoffs", `${sha}.json`), handoff);
  const feedbackPath = join(auditor, "feedback", `${sha}.json.gz`);
  await save(feedbackPath, gzipSync(JSON.stringify(originalFeedback)));
  const oldTask = join(root, "controller/tasks", `${id}-${sha}.json.gz`);
  const oldTaskBytes = gzipSync(JSON.stringify(f.task));
  await save(oldTask, oldTaskBytes);
  const configPath = join(root, "controller/config.json");
  const config = { maxDurationMs: 2400000, foundationSha256: f.task.foundationSha256, skill };
  await save(configPath, config);
  const args = [script, "--campaign", root, "--assignment-id", id, "--source-sha", sha];
  return {
    ...f,
    root,
    id,
    sha,
    label,
    auditor,
    task,
    binding,
    args,
    oldTask,
    oldTaskBytes,
    feedbackPath,
    originalFeedback,
    currentFeedback,
    config,
    configPath,
    handoff,
    audit,
  };
}

async function serve(
  f: Awaited<ReturnType<typeof fixture>>,
  options: { race?: boolean; wrongFoundation?: boolean } = {},
) {
  const requests: Array<{ method: string | undefined; url: string | undefined; body: string }> = [];
  const server: Server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    const task = options.wrongFoundation ? { ...f.task, foundationSha256: "b".repeat(64) } : f.task;
    const feedback = options.race
      ? { ...f.currentFeedback, reviewBase: { ...f.task.base, revision: f.task.base.revision + 1 } }
      : f.currentFeedback;
    const value =
      request.url === "/api/review/inbox"
        ? { sources: [{ source: f.inspected.source }] }
        : request.method === "POST"
          ? task
          : feedback;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server not bound");
  await save(f.configPath, { ...f.config, server: `http://127.0.0.1:${address.port}` });
  return requests;
}

describe("revision preparation at the current human base", () => {
  it("keeps the ordinary revision's exact task bytes without a network call", async () => {
    const f = await fixture("needs-revision");
    const result = JSON.parse((await exec("python3", f.args)).stdout);
    expect(
      await readFile(join(f.root, "controller/tasks", `${result.assignmentId}-${f.sha}.json.gz`)),
    ).toEqual(f.oldTaskBytes);
    expect(await readFile(f.oldTask)).toEqual(f.oldTaskBytes);
    const prior = await json(result.priorReviewPath);
    expect(prior.charts[0].taskBinding).toEqual(f.binding);
    expect(prior.charts[0].currentTask).toBeUndefined();
  });

  it("requires opt-in, preserves original lineage, and passes new task binding/human feedback to the actual exchange", async () => {
    const f = await fixture("supported");
    const requests = await serve(f);
    await save(f.feedbackPath, gzipSync(JSON.stringify(f.currentFeedback)));
    await expect(exec("python3", f.args)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Use explicit --current-base"),
    });
    expect(requests).toEqual([]);
    // Even an older saved snapshot must not hide the new human rejection in explicit mode.
    await save(f.feedbackPath, gzipSync(JSON.stringify(f.originalFeedback)));
    const handoffBytes = await readFile(join(f.label, "packets", `${f.sha}.json`));
    const auditBytes = await readFile(join(f.auditor, "packets", `${f.sha}.json`));
    const result = JSON.parse((await exec("python3", [...f.args, "--current-base"])).stdout);
    expect(requests).toEqual([
      { method: "POST", url: `/api/review/task/${f.sha}`, body: "{}" },
      { method: "GET", url: `/api/review/feedback/${f.sha}`, body: "" },
    ]);
    const taskPath = join(f.root, "controller/tasks", `${result.assignmentId}-${f.sha}.json.gz`);
    expect(JSON.parse(gunzipSync(await readFile(taskPath)).toString())).toEqual(f.task);
    expect(await readFile(f.oldTask)).toEqual(f.oldTaskBytes);
    expect(await readFile(join(f.label, "packets", `${f.sha}.json`))).toEqual(handoffBytes);
    expect(await readFile(join(f.auditor, "packets", `${f.sha}.json`))).toEqual(auditBytes);
    const prior = (await json(result.priorReviewPath)).charts[0];
    expect(prior.taskBinding).toEqual(f.binding);
    expect(prior.originalTaskGzipSha256).toBe(hash(f.oldTaskBytes));
    expect(prior.currentTask.taskBinding.base).toEqual(f.task.base);
    expect(prior.currentTask.taskBinding.taskSha256).toBe(f.task.taskSha256);
    expect(prior.currentTask.taskBinding.existingReviews[0].decision).toEqual(
      f.currentFeedback.agentReviews[0]?.decision,
    );
    expect(prior.reasons[0].kind).toBe("human-rejection");
    expect(prior.supersedes.handoffId).toBe(f.handoff.handoffId);
    const job = join(f.root, "workers", `${result.assignmentId}-labeler`);
    await save(join(job, "assignment.json"), await json(result.assignmentPath));
    await save(join(f.root, "admin/source-map.json"), []);
    await exec(process.execPath, [
      resolve("scripts/campaign-exchange.mjs"),
      "prepare",
      f.root,
      job,
    ]);
    const binding = (await json(join(job, "bindings.json")))[0];
    expect(binding).toEqual(prior.currentTask.taskBinding);
    expect(binding.humanObservations).toEqual(f.currentFeedback.directObservations);
    expect(binding.humanObservations[0]).toMatchObject({
      humanId: "fixture-expert",
      confirmedAt: expect.any(String),
      foundationSha256: f.task.foundationSha256,
      origin: { kind: "direct-human" },
      summary: {
        id: "direct-expert-tech",
        assessment: { presence: "present", salience: "supporting" },
      },
    });
    expect(await json(join(f.label, "bindings.json"))).toEqual([f.binding]);
    expect(JSON.parse(gunzipSync(await readFile(taskPath)).toString()).foundation).toEqual(
      f.registered.foundation,
    );
  });

  it("does not issue a task when the configured skill differs from the original frozen skill", async () => {
    const f = await fixture("supported");
    const requests = await serve(f);
    const config = await json(f.configPath);
    await save(f.configPath, { ...config, skill: { ...config.skill, version: "changed" } });
    await expect(exec("python3", [...f.args, "--current-base"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("preserve the original frozen skill"),
    });
    expect(requests).toEqual([]);
    expect(await readdir(join(f.root, "controller"))).not.toContain("revisions");
  });

  it.each(["race", "wrongFoundation"] as const)(
    "publishes no revision when issuance encounters %s",
    async (issue) => {
      const f = await fixture("supported");
      await serve(f, { [issue]: true });
      await expect(exec("python3", [...f.args, "--current-base"])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(issue === "race" ? "changed again" : "frozen Foundation"),
      });
      expect(await readdir(join(f.root, "controller"))).not.toContain("revisions");
      expect(await readFile(f.oldTask)).toEqual(f.oldTaskBytes);
    },
  );
});
