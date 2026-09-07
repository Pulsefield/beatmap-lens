import { describe, expect, it } from "vitest";
import {
  assertReviewDocumentV2,
  decideClaimV2,
  hashWorkflowValueV2,
  importAuditV2,
  importHandoffV2,
  readAgentReviewsV2,
  readExpertQueueV2,
  sealAuditV2,
  sealHandoffV2,
} from "./domain";
import { NOW, workflowFixture } from "./test-fixtures";

async function fixture() {
  const f = await workflowFixture();
  const original = await sealHandoffV2(f.task, {
    handoffId: "unresolved-original",
    createdAt: NOW,
    agent: f.handoff.agent,
    proposals: [{ ...f.claim, assessment: { presence: "unresolved" } }],
    audit: [],
    questions: [],
  });
  const imported = await importHandoffV2(f.registered, original, f.sourceBytes);
  const audit = await sealAuditV2(f.task, original, {
    auditId: "original-audit",
    createdAt: NOW,
    agent: { producerId: "original-auditor", role: "auditor" },
    claims: [
      {
        claimId: f.claim.id,
        outcome: "needs-expert",
        rationale: "No calibrated comparator yet.",
        expertReason: "semantic-boundary",
        question: "Does the target apply?",
      },
    ],
    questions: [],
  });
  const reviewed = await importAuditV2(imported.document, audit, f.sourceBytes);
  const input = {
    handoffId: "revised-handoff",
    createdAt: NOW,
    agent: { producerId: "new-labeler", role: "labeler" as const },
    proposals: [{ ...f.claim, id: "revised-claim", assessment: { presence: "absent" as const } }],
    audit: [],
    questions: [],
    supersedes: [
      {
        handoffId: original.handoffId,
        handoffSha256: await hashWorkflowValueV2(original),
        claimId: f.claim.id,
        replacementClaimId: "revised-claim",
      },
    ],
  };
  const replacement = await sealHandoffV2(f.task, input);
  const replacementAudit = await sealAuditV2(f.task, replacement, {
    auditId: "new-audit",
    createdAt: NOW,
    agent: { producerId: "new-auditor", role: "auditor" },
    claims: [
      {
        claimId: "revised-claim",
        outcome: "supported",
        rationale: "The new source-backed comparator settles this claim.",
      },
    ],
    questions: [],
  });
  return { ...f, original, reviewed: reviewed.document, input, replacement, replacementAudit };
}

describe("audited machine revisions", () => {
  it("retires only the linked claim after independent support, retaining immutable history", async () => {
    const f = await fixture();
    const imported = await importHandoffV2(f.reviewed, f.replacement, f.sourceBytes);
    expect(await readExpertQueueV2(imported.document)).toHaveLength(1);
    const audited = await importAuditV2(imported.document, f.replacementAudit, f.sourceBytes);
    expect((await readAgentReviewsV2(audited.document)).map((row) => row.status)).toEqual([
      "superseded",
      "agent-reviewed",
    ]);
    expect((await readAgentReviewsV2(audited.document))[0]?.supersededBy).toEqual({
      handoffId: f.replacement.handoffId,
      claimId: "revised-claim",
    });
    expect(await readExpertQueueV2(audited.document)).toHaveLength(0);
    expect(audited.document.handoffs[0]).toEqual(f.reviewed.handoffs[0]);
    expect(audited.document.decisions).toEqual([]);
    expect(audited.document.observations).toEqual([]);
    expect(
      await assertReviewDocumentV2(JSON.parse(JSON.stringify(audited.document)), f.sourceBytes),
    ).toEqual(audited.document);
    const conflicted = await sealAuditV2(f.task, f.replacement, {
      auditId: "conflicting-audit",
      createdAt: NOW,
      questions: [],
      agent: { producerId: "another-auditor", role: "auditor" },
      claims: [
        {
          claimId: "revised-claim",
          outcome: "needs-revision",
          rationale: "Submitted evidence does not establish the comparator.",
        },
      ],
    });
    const conflict = await importAuditV2(audited.document, conflicted, f.sourceBytes);
    expect((await readAgentReviewsV2(conflict.document)).map((row) => row.status)).toEqual([
      "needs-expert",
      "needs-expert",
    ]);
  });

  it("does not let a new machine judgment supersede a human decision", async () => {
    const f = await fixture();
    const human = await decideClaimV2(
      f.reviewed,
      {
        handoffId: f.original.handoffId,
        claimId: f.claim.id,
        disposition: "rejected",
        humanId: "expert",
        rationale: "Expert rejection.",
      },
      f.sourceBytes,
    );
    await expect(importHandoffV2(human, f.replacement, f.sourceBytes)).rejects.toThrow(
      "cannot supersede a human decision",
    );
    const imported = await importHandoffV2(f.reviewed, f.replacement, f.sourceBytes);
    const decidedLater = await decideClaimV2(
      imported.document,
      {
        handoffId: f.original.handoffId,
        claimId: f.claim.id,
        disposition: "rejected",
        humanId: "expert",
        rationale: "Expert arrived before the audit.",
      },
      f.sourceBytes,
    );
    const audited = await importAuditV2(decidedLater, f.replacementAudit, f.sourceBytes);
    expect((await readAgentReviewsV2(audited.document))[0]?.status).toBe("rejected");
    expect(await assertReviewDocumentV2(audited.document, f.sourceBytes)).toEqual(audited.document);
  });

  it("requires the original hash and the complete same-target scope", async () => {
    const f = await fixture();
    const expanded = await sealHandoffV2(f.task, {
      ...f.input,
      proposals: [{ ...f.claim, id: "revised-claim", scope: { startMs: 900, endMs: 1800 } }],
    });
    await expect(importHandoffV2(f.reviewed, expanded, f.sourceBytes)).rejects.toThrow(
      "complete original scope",
    );
    const wrongHash = await sealHandoffV2(f.task, {
      ...f.input,
      supersedes: [
        {
          handoffId: f.original.handoffId,
          claimId: f.claim.id,
          replacementClaimId: "revised-claim",
          handoffSha256: "0".repeat(64),
        },
      ],
    });
    await expect(importHandoffV2(f.reviewed, wrongHash, f.sourceBytes)).rejects.toThrow(
      "hash differs",
    );
  });

  it("requires a linear revision history and follows its independently supported end", async () => {
    const f = await fixture();
    const imported = await importHandoffV2(f.reviewed, f.replacement, f.sourceBytes);
    const competing = await sealHandoffV2(f.task, { ...f.input, handoffId: "competing-handoff" });
    await expect(importHandoffV2(imported.document, competing, f.sourceBytes)).rejects.toThrow(
      "already has a replacement",
    );
    const continuation = await sealHandoffV2(f.task, {
      ...f.input,
      handoffId: "final-handoff",
      supersedes: [
        {
          handoffId: f.replacement.handoffId,
          handoffSha256: await hashWorkflowValueV2(f.replacement),
          claimId: "revised-claim",
          replacementClaimId: "revised-claim",
        },
      ],
    });
    const continued = await importHandoffV2(imported.document, continuation, f.sourceBytes);
    const finalAudit = await sealAuditV2(f.task, continuation, {
      auditId: "final-audit",
      createdAt: NOW,
      agent: { producerId: "final-auditor", role: "auditor" },
      claims: [
        {
          claimId: "revised-claim",
          outcome: "supported",
          rationale: "The final claim resolves the source-backed uncertainty.",
        },
      ],
      questions: [],
    });
    const audited = await importAuditV2(continued.document, finalAudit, f.sourceBytes);
    expect((await readAgentReviewsV2(audited.document)).map((row) => row.status)).toEqual([
      "superseded",
      "superseded",
      "agent-reviewed",
    ]);
    expect(await readExpertQueueV2(audited.document)).toHaveLength(0);
    expect(await assertReviewDocumentV2(audited.document, f.sourceBytes)).toEqual(audited.document);
    const human = await decideClaimV2(
      audited.document,
      {
        handoffId: continuation.handoffId,
        claimId: "revised-claim",
        disposition: "accepted",
        humanId: "expert",
        rationale: "Confirmed the revised assessment.",
      },
      f.sourceBytes,
    );
    expect((await readAgentReviewsV2(human)).map((row) => row.status)).toEqual([
      "superseded",
      "superseded",
      "accepted",
    ]);
    const uncertainHuman = await decideClaimV2(
      audited.document,
      {
        handoffId: continuation.handoffId,
        claimId: "revised-claim",
        disposition: "deferred",
        humanId: "expert",
        rationale: "The assessment remains uncertain.",
      },
      f.sourceBytes,
    );
    expect((await readAgentReviewsV2(uncertainHuman)).map((row) => row.status)).toEqual([
      "stale",
      "stale",
      "deferred",
    ]);
  });
});
