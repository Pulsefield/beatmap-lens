import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
