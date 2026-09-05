import { describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { FakeDirectoryHandle } from "../test-helpers";
import type { AuditPacketV2 } from "./contracts";
import { WorkflowConflictError, WorkflowDirectoryV2 } from "./directory";
import {
  addHumanObservationV2,
  assertReviewDocumentV2,
  baseForTaskV2,
  decideClaimV2,
  importAuditV2,
  importHandoffV2,
  readAgentReviewsV2,
  readDispositionsV2,
  readExpertQueueV2,
  sealAuditV2,
  sealHandoffV2,
  validateAuditV2,
} from "./domain";
import { NOW, workflowFixture } from "./test-fixtures";

describe("independent audit exchange", () => {
  it("preserves standalone questions in legacy empty handoffs without admitting them as new production audits", async () => {
    const f = await workflowFixture();
    const original = {
      ...f.handoff,
      proposals: [],
      audit: [],
      questions: [
        {
          id: "standalone-question",
          claimIds: [],
          text: "This standalone semantic question belongs in curator review.",
        },
      ],
    };
    const imported = await importHandoffV2(f.registered, original, f.sourceBytes);
    const serialized = serializeCanonicalJson(imported.document);
    expect(
      serializeCanonicalJson(await assertReviewDocumentV2(JSON.parse(serialized), f.sourceBytes)),
    ).toBe(serialized);
    expect((await readDispositionsV2(imported.document)).handoffs[0]?.questions).toEqual(
      original.questions,
    );
    await expect(
      sealHandoffV2(f.task, {
        handoffId: original.handoffId,
        createdAt: original.createdAt,
        agent: original.agent,
        proposals: [],
        audit: [],
        questions: original.questions,
      }),
    ).rejects.toThrow("at least one source-backed claim");
    await expect(
      sealAuditV2(f.task, original, {
        ...submission(),
        claims: [],
        questions: [
          {
            questionId: "standalone-question",
            disposition: "needs-expert",
            rationale: "Curator semantics are needed.",
          },
        ],
      }),
    ).rejects.toThrow("at least one original claim");
  });

  it("retains undisputed results as agent-reviewed proposals and only queues concrete expert cases", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    expect((await readAgentReviewsV2(imported.document)).map((review) => review.status)).toEqual([
      "awaiting-audit",
      "awaiting-audit",
      "awaiting-audit",
    ]);
    expect(imported.document.handoffs[0]?.handoff.audit).toHaveLength(1);
    const audit = await sealAuditV2(f.task, f.handoff, submission());
    const reviewed = await importAuditV2(imported.document, audit, f.sourceBytes);
    expect((await readAgentReviewsV2(reviewed.document)).map((review) => review.status)).toEqual([
      "agent-reviewed",
      "agent-reviewed",
      "needs-expert",
    ]);
    expect(
      (await readExpertQueueV2(reviewed.document)).map((review) => ({
        claimId: review.claimId,
        question: review.question,
      })),
    ).toEqual([
      {
        claimId: "speedjack-claim",
        question: "Which interpretation should be used for this synthetic disputed claim?",
      },
    ]);
    expect(reviewed.document.decisions).toEqual([]);
    expect(reviewed.document.observations).toEqual([]);
    expect(reviewed.document.reviewRevision).toBe(imported.document.reviewRevision);
    expect(await baseForTaskV2(reviewed.document)).toEqual(f.task.base);
    expect(reviewed.document.handoffs[0]?.handoff).toEqual(f.handoff);
    const dispositions = await readDispositionsV2(reviewed.document);
    expect(dispositions.agentReviews[0]?.status).toBe("agent-reviewed");
    expect(dispositions.audits[0]?.audit.questions).toEqual(submission().questions);
    expect(dispositions.handoffs[0]?.claims[0]?.observations).toEqual([]);
  });

  it("checks original source, task, Foundation, handoff identity and independent provenance at the exchange boundary", async () => {
    const f = await workflowFixture();
    const audit = await sealAuditV2(f.task, f.handoff, submission());
    for (const field of [
      "sourceSha256",
      "taskSha256",
      "foundationSha256",
      "handoffSha256",
    ] as const) {
      await expect(
        validateAuditV2({ ...audit, [field]: "f".repeat(64) }, f.task, f.handoff),
      ).rejects.toThrow(field);
    }
    await expect(
      validateAuditV2({ ...audit, handoffId: "other-handoff" }, f.task, f.handoff),
    ).rejects.toThrow("handoffId");
    await expect(
      validateAuditV2(
        { ...audit, base: { ...audit.base, revision: audit.base.revision + 1 } },
        f.task,
        f.handoff,
      ),
    ).rejects.toThrow("base");
    await expect(
      validateAuditV2(
        { ...audit, agent: { ...audit.agent, producerId: f.handoff.agent.producerId } },
        f.task,
        f.handoff,
      ),
    ).rejects.toThrow("different producerId");
    await expect(validateAuditV2({ ...audit, decisions: [] }, f.task, f.handoff)).rejects.toThrow(
      "not an allowed field",
    );
  });

  it("requires complete claim and question dispositions and cannot settle unknown judgments by silent support", async () => {
    const f = await workflowFixture();
    const audit = await sealAuditV2(f.task, f.handoff, submission());
    await expect(
      validateAuditV2({ ...audit, claims: audit.claims.slice(1) }, f.task, f.handoff),
    ).rejects.toThrow("every original claim exactly once");
    await expect(validateAuditV2({ ...audit, questions: [] }, f.task, f.handoff)).rejects.toThrow(
      "every original question exactly once",
    );
    await expect(
      validateAuditV2(
        {
          ...audit,
          claims: audit.claims.map((claim) => ({
            claimId: claim.claimId,
            outcome: "supported",
            rationale: "Agreement.",
          })),
        },
        f.task,
        f.handoff,
      ),
    ).rejects.toThrow("unresolved or unreviewed");
    const questioned = {
      ...f.handoff,
      questions: [
        {
          id: "question-1",
          claimIds: [f.claim.id],
          text: "Does the initial claim have adequate evidence?",
        },
      ],
    };
    await expect(
      sealAuditV2(f.task, questioned, {
        ...submission(),
        questions: [
          {
            questionId: "question-1",
            disposition: "needs-revision",
            rationale: "Evidence must be revised before settling the question.",
          },
        ],
      }),
    ).rejects.toThrow("associated original question unresolved");
    const resolved = await sealAuditV2(f.task, questioned, {
      ...submission(),
      questions: [
        {
          questionId: "question-1",
          disposition: "resolved",
          rationale: "The complete source establishes the entering hold.",
        },
      ],
    });
    expect(resolved.questions[0]?.disposition).toBe("resolved");
  });

  it("retains conflicting audits together and lets an explicit human decision take precedence", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const first = await sealAuditV2(f.task, f.handoff, submission());
    const second = await sealAuditV2(f.task, f.handoff, {
      ...submission(),
      auditId: "audit-2",
      agent: { producerId: "another-auditor", role: "auditor" },
      claims: submission().claims.map((claim) =>
        claim.claimId === f.claim.id
          ? {
              claimId: claim.claimId,
              outcome: "needs-revision",
              rationale: "This witness selection does not establish the claim.",
            }
          : claim,
      ),
    });
    const reviewed = await importAuditV2(imported.document, first, f.sourceBytes);
    const conflicted = await importAuditV2(reviewed.document, second, f.sourceBytes);
    const queue = await readExpertQueueV2(conflicted.document);
    expect(queue.map((review) => review.claimId)).toEqual([f.claim.id, "speedjack-claim"]);
    expect(queue[0]?.expertReason).toBe("conflicting-audits");
    expect(queue[0]?.audits.map((audit) => audit.result.outcome)).toEqual([
      "supported",
      "needs-revision",
    ]);
    expect(conflicted.document.audits?.map((entry) => entry.audit)).toEqual([first, second]);
    const decided = await decideClaimV2(
      conflicted.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "accepted",
        humanId: "expert",
        rationale: "I inspected the source and resolved the audit disagreement.",
      },
      f.sourceBytes,
    );
    expect((await readAgentReviewsV2(decided))[0]?.status).toBe("accepted");
    expect((await readExpertQueueV2(decided)).map((review) => review.claimId)).toEqual([
      "speedjack-claim",
    ]);
    expect(decided.observations).toHaveLength(1);
    expect(decided.audits).toEqual(conflicted.document.audits);
  });

  it("keeps late audits stale, preserves existing human dispositions and makes repeated imports idempotent", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const decided = await decideClaimV2(
      imported.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "rejected",
        humanId: "expert",
        rationale: "The proposal is not supported.",
      },
      f.sourceBytes,
    );
    const deferred = await decideClaimV2(
      decided,
      {
        handoffId: f.handoff.handoffId,
        claimId: "speedjack-claim",
        disposition: "deferred",
        humanId: "expert",
        rationale: "Keep this semantic question deferred while other work continues.",
      },
      f.sourceBytes,
    );
    const unrelated = await addHumanObservationV2(
      deferred,
      { claim: { ...f.claim, id: "direct-human-claim" }, humanId: "expert" },
      f.sourceBytes,
    );
    const audit = await sealAuditV2(f.task, f.handoff, submission());
    const late = await importAuditV2(unrelated, audit, f.sourceBytes);
    expect(late.baseStatus).toBe("stale");
    expect((await readAgentReviewsV2(late.document)).map((review) => review.status)).toEqual([
      "rejected",
      "stale",
      "deferred",
    ]);
    expect(await readExpertQueueV2(late.document)).toEqual([]);
    expect(late.document.decisions).toEqual(unrelated.decisions);
    expect(late.document.observations).toEqual(unrelated.observations);
    const duplicate = await importAuditV2(late.document, audit, f.sourceBytes);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.document).toBe(late.document);
    await expect(
      importAuditV2(late.document, { ...audit, createdAt: "changed" }, f.sourceBytes),
    ).rejects.toThrow("different immutable content");
  });

  it("persists audits through canonical commands while preserving legacy snapshot bytes without an audits field", async () => {
    const f = await workflowFixture();
    const legacyBytes = serializeCanonicalJson(f.registered);
    const legacy = await assertReviewDocumentV2(JSON.parse(legacyBytes), f.sourceBytes);
    expect(serializeCanonicalJson(legacy)).toBe(legacyBytes);
    expect("audits" in legacy).toBe(false);
    const root = new FakeDirectoryHandle();
    const directory = new WorkflowDirectoryV2(root);
    const initial = await directory.initialize(f.sourceBytes, f.foundation);
    const approved = await directory.approveFoundation(f.sourceBytes, initial.version, "expert");
    const exported = await directory.exportTask(f.sourceBytes, approved.version);
    const handoff = await sealHandoffV2(exported.task, {
      handoffId: f.handoff.handoffId,
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals: f.handoff.proposals,
      audit: f.handoff.audit,
      questions: f.handoff.questions,
    });
    const imported = await directory.importHandoff(f.sourceBytes, exported.stored.version, handoff);
    const audit = await sealAuditV2(exported.task, handoff, submission());
    const result = await directory.importAudit(f.sourceBytes, imported.stored.version, audit);
    expect(
      await new WorkflowDirectoryV2(root).read(f.inspected.source.sha256, f.sourceBytes),
    ).toEqual(result.stored);
    const duplicate = await directory.importAudit(f.sourceBytes, result.stored.version, audit);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.stored.version).toEqual(result.stored.version);
    await expect(
      directory.importAudit(f.sourceBytes, imported.stored.version, audit),
    ).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(result.stored.document.observations).toEqual([]);
  });
});

function submission(): Pick<
  AuditPacketV2,
  "auditId" | "createdAt" | "agent" | "claims" | "questions"
> {
  return {
    auditId: "audit-1",
    createdAt: NOW,
    agent: { producerId: "independent-auditor", role: "auditor" },
    claims: [
      {
        claimId: "tech-claim",
        outcome: "supported",
        rationale: "Independent review supports this synthetic proposal's source-backed claim.",
      },
      {
        claimId: "streams-claim",
        outcome: "supported",
        rationale: "Independent review supports the second synthetic claim.",
      },
      {
        claimId: "speedjack-claim",
        outcome: "needs-expert",
        rationale: "The proposal itself leaves this judgment unresolved.",
        expertReason: "semantic-ambiguity",
        question: "Which interpretation should be used for this synthetic disputed claim?",
      },
    ],
    questions: [
      {
        questionId: "question-1",
        disposition: "needs-expert",
        rationale: "The original semantic question remains open for the expert.",
      },
    ],
  };
}
