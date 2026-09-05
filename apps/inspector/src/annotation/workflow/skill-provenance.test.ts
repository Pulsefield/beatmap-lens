import { describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import type { AuditPacketV2, SkillProvenanceV2 } from "./contracts";
import {
  assertReviewDocumentV2,
  hashWorkflowValueV2,
  importAuditV2,
  importHandoffV2,
  readDispositionsV2,
  sealAuditV2,
  sealHandoffV2,
  validateAuditV2,
  validateHandoffV2,
} from "./domain";
import { NOW, workflowFixture } from "./test-fixtures";

const labelerSkill: SkillProvenanceV2 = {
  name: "fixture-judgment-skill",
  version: "fixture-1",
  sha256: "1".repeat(64),
};
const auditorSkill: SkillProvenanceV2 = {
  name: "fixture-judgment-skill",
  version: "fixture-2",
  sha256: "2".repeat(64),
};

describe("immutable skill provenance", () => {
  it("preserves legacy packet hashes and absent skill fields when reopening", async () => {
    const f = await workflowFixture();
    const audit = await sealAuditV2(f.task, f.handoff, auditInput(f));
    const handoffBytes = serializeCanonicalJson(f.handoff);
    const auditBytes = serializeCanonicalJson(audit);
    expect(await hashWorkflowValueV2(f.handoff)).toBe(
      "53feabf3a2d8c0e3047b0c24086bfbfd1be30a8a160e265320122230a78758da",
    );
    expect(await hashWorkflowValueV2(audit)).toBe(
      "070a7b98c6d7376af387ad88ea62800c0b9f7889893ecb41fbadd60b47d34572",
    );
    expect(serializeCanonicalJson(await validateHandoffV2(JSON.parse(handoffBytes), f.task))).toBe(
      handoffBytes,
    );
    expect(
      serializeCanonicalJson(await validateAuditV2(JSON.parse(auditBytes), f.task, f.handoff)),
    ).toBe(auditBytes);
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const reviewed = await importAuditV2(imported.document, audit, f.sourceBytes);
    const bytes = serializeCanonicalJson(reviewed.document);
    const restored = await assertReviewDocumentV2(JSON.parse(bytes), f.sourceBytes);
    expect(serializeCanonicalJson(restored)).toBe(bytes);
    expect(restored.handoffs[0]?.handoff.agent).not.toHaveProperty("skill");
    expect(restored.audits?.[0]?.audit.agent).not.toHaveProperty("skill");
  });

  it("retains each producer's exact skill snapshot in canonical records and dispositions", async () => {
    const { f, handoff, audit, document } = await skillPackets();
    const bytes = serializeCanonicalJson(document);
    const restored = await assertReviewDocumentV2(JSON.parse(bytes), f.sourceBytes);
    expect(serializeCanonicalJson(restored)).toBe(bytes);
    expect(restored.handoffs[0]?.handoff.agent.skill).toEqual(labelerSkill);
    expect(restored.audits?.[0]?.audit.agent.skill).toEqual(auditorSkill);
    expect(audit.handoffSha256).toBe(await hashWorkflowValueV2(handoff));
    const dispositions = await readDispositionsV2(restored);
    expect(dispositions.handoffs[0]?.agent).toEqual(handoff.agent);
    expect(dispositions.audits[0]?.audit.agent).toEqual(audit.agent);
    expect(restored.decisions).toEqual([]);
    expect(restored.observations).toEqual([]);
    expect(restored.reviewRevision).toBe(f.registered.reviewRevision);
  });

  it("rejects changing skill provenance under an original handoff or audit identity", async () => {
    const { f, handoff, audit, document } = await skillPackets();
    const changedHandoff = {
      ...handoff,
      agent: { ...handoff.agent, skill: { ...labelerSkill, sha256: "3".repeat(64) } },
    };
    await expect(validateAuditV2(audit, f.task, changedHandoff)).rejects.toThrow("handoffSha256");
    await expect(importHandoffV2(document, changedHandoff, f.sourceBytes)).rejects.toThrow(
      "different immutable content",
    );
    const changedAudit = {
      ...audit,
      agent: { ...audit.agent, skill: { ...auditorSkill, version: "changed-version" } },
    };
    await expect(importAuditV2(document, changedAudit, f.sourceBytes)).rejects.toThrow(
      "different immutable content",
    );
    await expect(
      assertReviewDocumentV2(
        {
          ...document,
          audits: document.audits?.map((entry) => ({ ...entry, audit: changedAudit })),
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("auditSha256");
    expect(document.handoffs[0]?.handoff.agent.skill).toEqual(labelerSkill);
    expect(document.audits?.[0]?.audit.agent.skill).toEqual(auditorSkill);
  });

  it("requires a complete versioned digest when a skill declaration is supplied", async () => {
    const { f, handoff, audit } = await skillPackets();
    for (const skill of [
      { name: labelerSkill.name, sha256: labelerSkill.sha256 },
      { ...labelerSkill, sha256: "not-a-bundle-digest" },
      { ...labelerSkill, approvedBy: "not-an-agent-approval-field" },
    ]) {
      await expect(
        validateHandoffV2({ ...handoff, agent: { ...handoff.agent, skill } }, f.task),
      ).rejects.toThrow("skill");
      await expect(
        validateAuditV2({ ...audit, agent: { ...audit.agent, skill } }, f.task, handoff),
      ).rejects.toThrow("skill");
    }
  });
});

function auditInput(
  f: Awaited<ReturnType<typeof workflowFixture>>,
): Pick<AuditPacketV2, "auditId" | "createdAt" | "agent" | "claims" | "questions"> {
  return {
    auditId: "legacy-skill-free-audit",
    createdAt: NOW,
    agent: { producerId: "independent-auditor", role: "auditor" },
    claims: f.handoff.proposals.map((claim) => ({
      claimId: claim.id,
      outcome: "needs-revision",
      rationale: "Check this synthetic claim.",
    })),
    questions: f.handoff.questions.map((question) => ({
      questionId: question.id,
      disposition: "needs-revision",
      rationale: "Resolve this fixture question.",
    })),
  };
}

async function skillPackets() {
  const f = await workflowFixture();
  const handoff = await sealHandoffV2(f.task, {
    handoffId: "versioned-skill-handoff",
    createdAt: NOW,
    agent: { ...f.handoff.agent, skill: labelerSkill },
    proposals: f.handoff.proposals,
    audit: f.handoff.audit,
    questions: f.handoff.questions,
  });
  const input = auditInput(f);
  const audit = await sealAuditV2(f.task, handoff, {
    ...input,
    agent: { ...input.agent, skill: auditorSkill },
  });
  const imported = await importHandoffV2(f.registered, handoff, f.sourceBytes);
  const reviewed = await importAuditV2(imported.document, audit, f.sourceBytes);
  return { f, handoff, audit, document: reviewed.document };
}
