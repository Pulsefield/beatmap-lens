import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import {
  createReviewDocumentV2,
  createTaskPacketV2,
  hashWorkflowValueV2,
  registerTaskV2,
  sealAuditV2,
  sealHandoffV2,
} from "./domain";
import { NOW, workflowFixture } from "./test-fixtures";

const serviceUrl = pathToFileURL(resolve("scripts/review-workspace.mjs")).href;
const exec = promisify(execFile);
const { startReviewWorkspace } = await import(/* @vite-ignore */ serviceUrl);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const f = await workflowFixture();
  const workspace = await mkdtemp(join(tmpdir(), "review-service-"));
  cleanups.push(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, "workflow"));
  await writeFile(
    join(workspace, "workflow", `${f.inspected.source.sha256}.v2.json`),
    serializeCanonicalJson(f.registered),
  );
  const handoff = await sealHandoffV2(f.task, {
    handoffId: "parallel-handoff",
    createdAt: NOW,
    agent: { role: "labeler", producerId: "service-labeler" },
    proposals: f.handoff.proposals.slice(0, 2),
    audit: [],
    questions: [],
  });
  const audit = await sealAuditV2(f.task, handoff, {
    auditId: "independent-service-audit",
    createdAt: NOW,
    agent: { role: "auditor", producerId: "service-auditor" },
    claims: handoff.proposals.map((claim) => ({
      claimId: claim.id,
      outcome: "supported",
      rationale: "Independent source review agrees with this synthetic fixture claim.",
    })),
    questions: [],
  });
  const request = {
    requestId: "two-claim-spot-check",
    sourceSha256: f.inspected.source.sha256,
    handoffId: handoff.handoffId,
    handoffSha256: await hashWorkflowValueV2(handoff),
    claimIds: handoff.proposals.map((claim) => claim.id),
    reason: "spot-check",
    question: "Please spot-check these two fixture claims independently.",
    requestedBy: { producerId: "service-curator", role: "curator" },
    createdAt: NOW,
  };
  return { ...f, workspace, handoff, audit, request, sha: f.inspected.source.sha256 };
}

async function start(workspace: string) {
  const service = await startReviewWorkspace({ workspace, port: 0, pollIntervalMs: 25 });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await service.close();
  };
  cleanups.push(close);
  return { ...service, close };
}

async function post(url: string, pathname: string, body: unknown) {
  const response = await fetch(`${url}/api/review/${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, value: await response.json() };
}

async function get(url: string, pathname: string) {
  const response = await fetch(`${url}/api/review/${pathname}`);
  expect(response.status).toBe(200);
  return response.json();
}

describe("local Review service exchange", () => {
  it("returns compact agent feedback with exact human modifications and immutable provenance", async () => {
    const f = await fixture();
    const service = await start(f.workspace);
    const handoff = await sealHandoffV2(f.task, {
      handoffId: "feedback-handoff",
      createdAt: NOW,
      agent: {
        ...f.handoff.agent,
        skill: { name: "fixture-judgment", version: "1", sha256: "a".repeat(64) },
      },
      proposals: f.handoff.proposals,
      audit: f.handoff.audit,
      questions: [{ id: "scope-question", claimIds: [f.claim.id], text: "Check the entry hold." }],
    });
    const audit = await sealAuditV2(f.task, handoff, {
      auditId: "feedback-audit",
      createdAt: NOW,
      agent: {
        ...f.audit.agent,
        skill: { name: "fixture-judgment", version: "2", sha256: "b".repeat(64) },
      },
      claims: f.audit.claims,
      questions: [
        {
          questionId: "scope-question",
          disposition: "resolved",
          rationale: "The exact entering hold is present.",
        },
      ],
    });
    expect((await post(service.url, "submit", { kind: "handoff", packet: handoff })).status).toBe(
      200,
    );
    expect((await post(service.url, "submit", { kind: "audit", packet: audit })).status).toBe(200);
    const initial = await get(service.url, `feedback/${f.sha}`);
    expect(initial.taskBinding).toEqual({
      taskId: f.task.taskId,
      taskSha256: f.task.taskSha256,
      foundationSha256: f.task.foundationSha256,
      base: f.task.base,
    });
    expect(initial.reviewBase).toEqual(f.task.base);
    expect(initial.counts).toEqual({ total: 2, "agent-reviewed": 2 });
    expect(initial.handoffs[0]).toMatchObject({
      handoffId: handoff.handoffId,
      handoffSha256: await hashWorkflowValueV2(handoff),
      agent: handoff.agent,
      questions: handoff.questions,
    });
    expect(initial.audits[0]).toMatchObject({
      auditId: audit.auditId,
      auditSha256: await hashWorkflowValueV2(audit),
      agent: audit.agent,
      questions: audit.questions,
    });
    expect(initial.agentReviews[0].summary).toMatchObject({
      scope: f.claim.scope,
      reviewContext: f.claim.reviewContext,
      assessment: f.claim.assessment,
      rationale: f.claim.evidence.rationale,
      witnessCount: f.claim.evidence.noteRefs.length,
      boundaryUncertainty: f.claim.boundaryUncertainty,
      transition: { description: f.claim.transition?.description, witnessCount: 2 },
    });
    expect(initial.agentReviews[0].audits).toEqual([
      { auditId: audit.auditId, result: audit.claims[0] },
    ]);
    expect(JSON.stringify(initial)).not.toMatch(
      /"(?:sourceBytes|foundation|structure|noteRefs|contextNoteRefs)":/,
    );
    const modifiedClaim = {
      ...f.claim,
      assessment: { presence: "present", salience: "supporting" },
      evidence: {
        ...f.claim.evidence,
        noteRefs: [f.refs[0], f.refs[4]],
        rationale: "Human correction retains the entering hold and later discontiguous witness.",
      },
    };
    const modified = await post(service.url, `human/${f.sha}/decide`, {
      expectedBase: initial.documentVersion,
      input: {
        handoffId: handoff.handoffId,
        claimId: f.claim.id,
        disposition: "modified",
        humanId: "local-expert",
        rationale: "Use supporting salience for these specific witnesses.",
        modifiedClaim,
      },
    });
    expect(modified.status).toBe(200);
    const feedback = await get(service.url, `feedback/${f.sha}`);
    expect(feedback.documentVersion).toEqual(modified.value.version);
    expect(feedback.reviewBase.revision).toBe(initial.reviewBase.revision + 1);
    expect(feedback.taskBinding).toEqual(initial.taskBinding);
    expect(feedback.agentReviews[0].summary).toEqual(initial.agentReviews[0].summary);
    expect(feedback.agentReviews[0].decision).toEqual(modified.value.document.decisions[0]);
    expect(feedback.agentReviews[0].modifiedClaim).toEqual(modifiedClaim);
    expect(feedback.agentReviews[1]).not.toHaveProperty("modifiedClaim");
    expect(feedback.counts).toEqual({ total: 2, modified: 1, "agent-reviewed": 1 });
    const withoutModified = structuredClone(feedback);
    delete withoutModified.agentReviews[0].modifiedClaim;
    expect(JSON.stringify(withoutModified)).not.toMatch(
      /"(?:sourceBytes|foundation|structure|noteRefs|contextNoteRefs)":/,
    );
    expect((await get(service.url, `dispositions/${f.sha}`)).agentReviews[0].claim).toEqual(
      f.claim,
    );
    expect((await get(service.url, `source/${f.sha}`)).version).toEqual(modified.value.version);
    await service.close();
    const restarted = await start(f.workspace);
    expect(restarted.cacheInfo().fullSourceReads).toBe(0);
    expect(await get(restarted.url, `feedback/${f.sha}`)).toEqual(feedback);
    expect(restarted.cacheInfo().fullSourceReads).toBe(0);
  }, 10_000);

  it("bounds full-source retention while unchanged inbox polls use compact summaries", async () => {
    const f = await fixture();
    const service = await start(f.workspace);
    await post(service.url, "submit", { kind: "handoff", packet: f.handoff });
    await post(service.url, "submit", { kind: "audit", packet: f.audit });
    await post(service.url, "submit", { kind: "review-request", packet: f.request });
    const original = await get(service.url, `source/${f.sha}`);
    for (let index = 0; index < 5; index++) {
      const sourceBytes = Array.from(
        new TextEncoder().encode(
          new TextDecoder()
            .decode(f.sourceBytes)
            .replace("Version: Mixed", `Version: Batch ${index}`),
        ),
      );
      const registered = await post(service.url, "source", {
        sourceBytes,
        foundationSourceSha256: f.sha,
        foundationSha256: f.task.foundationSha256,
      });
      expect(registered.status).toBe(200);
    }
    const warmed = service.cacheInfo();
    expect(warmed).toMatchObject({ fullSources: 1, summaries: 6 });
    for (let poll = 0; poll < 3; poll++) {
      const inbox = await get(service.url, "inbox");
      expect(inbox.sources).toHaveLength(6);
      const initial = inbox.sources.find(
        (row: { source: { sha256: string } }) => row.source.sha256 === f.sha,
      );
      expect(initial.counts).toEqual({ total: 2, "agent-reviewed": 2 });
      expect(initial.requests[0].pendingClaimIds).toEqual(f.request.claimIds);
      const feedback = await get(service.url, `feedback/${f.sha}`);
      expect(feedback.counts).toEqual(initial.counts);
    }
    expect(service.cacheInfo()).toEqual(warmed);
    expect(await get(service.url, `source/${f.sha}`)).toEqual(original);
    expect(service.cacheInfo()).toEqual({ ...warmed, fullSourceReads: warmed.fullSourceReads + 1 });
    const decided = await post(service.url, `human/${f.sha}/decide`, {
      expectedBase: original.version,
      input: {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "accepted",
        humanId: "local-expert",
        rationale: "Check the summary after reopening an evicted source.",
      },
    });
    expect(decided.status).toBe(200);
    const updated = await get(service.url, "inbox");
    const initial = updated.sources.find(
      (row: { source: { sha256: string } }) => row.source.sha256 === f.sha,
    );
    expect(initial.version).toEqual(decided.value.version);
    expect(initial.counts).toEqual({ total: 2, accepted: 1, "agent-reviewed": 1 });
    expect(initial.requests[0].pendingClaimIds).toEqual(["streams-claim"]);
    const refreshed = service.cacheInfo();
    await get(service.url, "inbox");
    expect(service.cacheInfo()).toEqual(refreshed);
    expect(refreshed.fullSources).toBe(1);
  }, 10_000);

  it("registers a local source through the real CLI using the original canonical Foundation approval", async () => {
    const f = await fixture();
    const service = await start(f.workspace);
    const sourcePath = join(f.workspace, "another.osu");
    const outputPath = join(f.workspace, "registered-task.json");
    const newBytes = new TextEncoder().encode(
      new TextDecoder().decode(f.sourceBytes).replace("Version: Mixed", "Version: Another"),
    );
    await writeFile(sourcePath, newBytes);
    const script = resolve("scripts/annotation-workflow.mjs");
    const args = [
      script,
      "register-source",
      "--server",
      service.url,
      "--source",
      sourcePath,
      "--foundation-source-sha",
      f.sha,
      "--foundation-sha",
      f.task.foundationSha256,
      "--out",
      outputPath,
    ];
    await exec(process.execPath, args);
    const task = JSON.parse(await readFile(outputPath, "utf8"));
    expect(task.contract).toBe("beatmap-lens-agent-task");
    expect(task.sourceBytes).toEqual(Array.from(newBytes));
    expect(task.foundation).toEqual(f.task.foundation);
    expect(task.foundationSha256).toBe(f.task.foundationSha256);
    const stored = await get(service.url, `source/${task.source.sha256}`);
    expect(stored.document.tasks).toEqual([task]);
    expect(stored.document.decisions).toEqual([]);
    expect(stored.document.observations).toEqual([]);
    expect(stored.document.reviewRevision).toBe(1);
    expect((await get(service.url, "inbox")).sources).toHaveLength(2);
    await exec(process.execPath, args);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(task);
    expect(await get(service.url, `source/${task.source.sha256}`)).toEqual(stored);
    const rejected = await post(service.url, "source", {
      sourceBytes: Array.from(newBytes),
      foundationSourceSha256: f.sha,
      foundationSha256: "0".repeat(64),
    });
    expect(rejected.status).toBe(400);
    expect(rejected.value.error).toContain("Foundation hash differs");
    expect(await get(service.url, `source/${task.source.sha256}`)).toEqual(stored);
    const evidence = join(f.workspace, "registered-evidence");
    await exec(process.execPath, [script, "evidence", "--task", outputPath, "--out", evidence]);
    expect(await readFile(join(evidence, "source.osu"))).toEqual(Buffer.from(newBytes));
  }, 10_000);

  it("accepts independent concurrent deliveries, persists partial human decisions, and survives restart", async () => {
    const f = await fixture();
    const service = await start(f.workspace);
    const original = await get(service.url, `source/${f.sha}`);
    const responses = await Promise.all([
      post(service.url, "submit", { kind: "audit", packet: f.audit }),
      post(service.url, "submit", { kind: "handoff", packet: f.handoff }),
      post(service.url, "submit", { kind: "review-request", packet: f.request }),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    await service.processInbox();
    const inbox = await get(service.url, "inbox");
    expect(inbox.sources[0].counts).toEqual({ total: 2, "agent-reviewed": 2 });
    expect(inbox.sources[0].expertQueue).toEqual([]);
    expect(inbox.sources[0].requests[0].pendingClaimIds).toEqual(f.request.claimIds);
    const current = await get(service.url, `source/${f.sha}`);
    expect(current.sourceBytes).toEqual(Array.from(f.sourceBytes));
    expect(current.document.decisions).toEqual([]);
    expect(current.document.observations).toEqual([]);
    const input = {
      handoffId: f.handoff.handoffId,
      claimId: f.claim.id,
      disposition: "accepted",
      humanId: "local-expert",
      rationale: "This specific fixture claim was checked by the human.",
    };
    const conflict = await post(service.url, `human/${f.sha}/decide`, {
      expectedBase: original.version,
      input,
    });
    expect(conflict).toMatchObject({ status: 409, value: { actual: current.version } });
    const [decided, retry] = await Promise.all([
      post(service.url, `human/${f.sha}/decide`, { expectedBase: current.version, input }),
      post(service.url, "submit", { kind: "audit", packet: f.audit }),
    ]);
    expect(decided.status).toBe(200);
    expect(retry.status).toBe(200);
    const readback = await get(service.url, `dispositions/${f.sha}`);
    expect(readback.agentReviews.map((row: { status: string }) => row.status)).toEqual([
      "accepted",
      "agent-reviewed",
    ]);
    expect(readback.handoffs[0].claims[0].observations).toHaveLength(1);
    expect(readback.reviewRequests[0].pendingClaimIds).toEqual(["streams-claim"]);
    const deferred = await post(service.url, `human/${f.sha}/decide`, {
      expectedBase: decided.value.version,
      input: {
        ...input,
        claimId: "streams-claim",
        disposition: "deferred",
        rationale: "Leave unsettled.",
      },
    });
    expect(deferred.status).toBe(200);
    const beforeRestart = await get(service.url, `source/${f.sha}`);
    const dispositions = await get(service.url, `dispositions/${f.sha}`);
    expect(dispositions.reviewRequests[0].pendingClaimIds).toEqual([]);
    expect(dispositions.agentReviews.map((row: { status: string }) => row.status)).toEqual([
      "accepted",
      "deferred",
    ]);
    expect(
      JSON.parse(
        await readFile(join(f.workspace, "exchange/outbox", `${f.sha}.dispositions.json`), "utf8"),
      ),
    ).toEqual(dispositions);
    expect((await get(service.url, `task/${f.sha}`)).taskSha256).toBe(f.task.taskSha256);
    await service.close();
    const restarted = await start(f.workspace);
    const repeat = await post(restarted.url, "submit", { kind: "handoff", packet: f.handoff });
    expect(repeat.status).toBe(200);
    expect(await get(restarted.url, `source/${f.sha}`)).toEqual(beforeRestart);
    expect((await get(restarted.url, "inbox")).sources[0].requests[0].pendingClaimIds).toEqual([]);
    expect(await readdir(join(f.workspace, "exchange/receipts"))).toHaveLength(3);
    const fresh = await post(restarted.url, `task/${f.sha}`, {});
    expect(fresh.status).toBe(200);
    expect(fresh.value.taskSha256).not.toBe(f.task.taskSha256);
    expect(fresh.value.base.revision).toBe(beforeRestart.document.reviewRevision);
    expect((await get(restarted.url, `task/${f.sha}`)).taskSha256).toBe(fresh.value.taskSha256);
    const refreshed = await get(restarted.url, `source/${f.sha}`);
    expect(refreshed.document.decisions).toEqual(beforeRestart.document.decisions);
    expect(refreshed.document.observations).toEqual(beforeRestart.document.observations);
  }, 20_000);

  it("polls raw inbox packets and persists visible immutable-target and machine-authority errors", async () => {
    const f = await fixture();
    const service = await start(f.workspace);
    const inboxPath = join(f.workspace, "exchange/inbox");
    const wrongHost = await new Promise<number | undefined>((resolveStatus, reject) => {
      httpGet(
        `${service.url}/api/review/inbox`,
        { headers: { Host: "untrusted.example" } },
        (response) => {
          response.resume();
          resolveStatus(response.statusCode);
        },
      ).on("error", reject);
    });
    expect(wrongHost).toBe(403);
    const wrongOrigin = await fetch(`${service.url}/api/review/inbox`, {
      headers: { Origin: "https://untrusted.example" },
    });
    expect(wrongOrigin.status).toBe(403);
    await writeFile(join(inboxPath, "01-audit.json"), JSON.stringify(f.audit));
    await writeFile(join(inboxPath, "02-handoff.json"), JSON.stringify(f.handoff));
    await expect
      .poll(async () => (await get(service.url, "inbox")).sources[0].counts["agent-reviewed"], {
        timeout: 5000,
      })
      .toBe(2);
    const before = await get(service.url, `source/${f.sha}`);
    const invalid = await post(service.url, "submit", {
      kind: "handoff",
      packet: {
        ...f.handoff,
        handoffId: "agent-cannot-confirm",
        decisions: [{ disposition: "accepted" }],
      },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.value.status).toBe("error");
    expect(invalid.value.error).toContain("not an allowed field");
    const wrongTarget = await post(service.url, "submit", {
      kind: "review-request",
      packet: { ...f.request, handoffSha256: "0".repeat(64) },
    });
    expect(wrongTarget.status).toBe(400);
    expect(wrongTarget.value.error).toContain("different immutable handoff content");
    expect(await get(service.url, `source/${f.sha}`)).toEqual(before);
    const valid = await post(service.url, "submit", { kind: "review-request", packet: f.request });
    expect(valid.status).toBe(200);
    const changed = await post(service.url, "submit", {
      kind: "review-request",
      packet: { ...f.request, question: "Silently replaced question" },
    });
    expect(changed.status).toBe(400);
    const inbox = await get(service.url, "inbox");
    expect(
      inbox.receipts.filter((receipt: { status: string }) => receipt.status === "error"),
    ).toHaveLength(3);
    expect(inbox.sources[0].requests[0].question).toBe(f.request.question);
    await writeFile(join(inboxPath, "broken.json"), "{unfinished");
    await service.processInbox();
    expect(
      (await get(service.url, "inbox")).receipts.some(
        (receipt: { filename?: string; status: string }) =>
          receipt.filename === "broken.json" && receipt.status === "error",
      ),
    ).toBe(true);
  }, 15_000);

  it("issues fresh agent tasks only after explicit Foundation approval", async () => {
    const f = await fixture();
    const proposed = await createReviewDocumentV2(f.inspected.source, f.foundation);
    const task = await createTaskPacketV2(proposed, f.sourceBytes);
    const registered = await registerTaskV2(proposed, task, f.sourceBytes);
    await writeFile(
      join(f.workspace, "workflow", `${f.sha}.v2.json`),
      serializeCanonicalJson(registered),
    );
    const service = await start(f.workspace);
    const denied = await post(service.url, `task/${f.sha}`, {});
    expect(denied.status).toBe(400);
    expect(denied.value.error).toContain("human approval");
    const current = await get(service.url, `source/${f.sha}`);
    expect(current.document.tasks).toHaveLength(1);
    const approved = await post(service.url, `human/${f.sha}/approveFoundation`, {
      expectedBase: current.version,
      input: { humanId: "local-expert" },
    });
    expect(approved.status).toBe(200);
    const issued = await post(service.url, `task/${f.sha}`, {});
    expect(issued.status).toBe(200);
    expect(issued.value.foundation.approval.status).toBe("human-approved");
    const latest = await get(service.url, `source/${f.sha}`);
    expect(latest.document.reviewRevision).toBe(approved.value.document.reviewRevision);
    expect(latest.document.decisions).toEqual([]);
    expect(latest.document.observations).toEqual([]);
  }, 10_000);
});

import { execFile } from "node:child_process";
