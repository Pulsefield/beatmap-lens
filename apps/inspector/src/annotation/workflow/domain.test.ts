import { describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { FakeDirectoryHandle } from "../test-helpers";
import type { ClaimV2, CommunityAlignmentV2, FoundationV2 } from "./contracts";
import { WorkflowDirectoryV2 } from "./directory";
import {
  addHumanObservationsV2,
  addHumanObservationV2,
  assertFoundationV2,
  assertReviewDocumentV2,
  assertTaskPacketV2,
  baseForTaskV2,
  decideClaimV2,
  decideSectionV2,
  effectiveHumanObservationsV2,
  handoffBaseStatusV2,
  handoffTrustV2,
  hashWorkflowValueV2,
  importAuditV2,
  importHandoffV2,
  readAgentReviewsV2,
  readDispositionsV2,
  sealAuditV2,
  sealHandoffV2,
  validateAuditV2,
  validateHandoffV2,
} from "./domain";
import { createExperimentalFoundationV2 } from "./experimental-campaign";
import { historicalAcceptance, NOW, workflowFixture } from "./test-fixtures";

describe("V2 source-backed agent–human domain", () => {
  it("preserves unspecified history and appends confidence-only direct revisions with new bindings", async () => {
    const f = await workflowFixture();
    const original = await addHumanObservationV2(
      f.registered,
      { humanId: "expert", id: "original", claim: f.claim },
      f.sourceBytes,
    );
    const previous = original.observations[0];
    if (!previous) throw new Error("Missing human observation.");
    expect(previous).not.toHaveProperty("confidence");
    const before = serializeCanonicalJson(original);
    const revised = await addHumanObservationV2(
      original,
      {
        humanId: "expert",
        id: "confident",
        claim: previous.claim,
        supersedesObservationId: previous.id,
        confidence: "high",
      },
      f.sourceBytes,
    );
    expect(serializeCanonicalJson(original)).toBe(before);
    expect(revised.observations[0]).toEqual(previous);
    const [effective] = effectiveHumanObservationsV2(revised);
    expect(effective).toMatchObject({ confidence: "high", claim: previous.claim });
    expect(effective?.claim).not.toHaveProperty("confidence");
    expect(revised.reviewRevision).toBe(original.reviewRevision + 1);
    expect(await baseForTaskV2(revised)).not.toEqual(await baseForTaskV2(original));
    expect(await hashWorkflowValueV2(effective)).not.toEqual(
      await hashWorkflowValueV2({ ...effective, confidence: "low" }),
    );
    await expect(assertReviewDocumentV2(revised, f.sourceBytes)).resolves.toEqual(revised);
  });

  it("normalizes differing legacy cuts within one section identity but never combines distinct sections", async () => {
    const f = await workflowFixture();
    const proposals: ClaimV2[] = ["tech", "streams"].map((tagId, index) => ({
      id: `legacy-${tagId}`,
      sectionId: "legacy-section",
      tagId,
      playbackRate: 0.75,
      scope: index === 0 ? { startMs: 900, endMs: 1800 } : { startMs: 1000, endMs: 1700 },
      reviewContext: f.claim.reviewContext,
      assessment: f.claim.assessment,
      evidence: f.claim.evidence,
    }));
    const handoff = await sealHandoffV2(f.task, {
      handoffId: "legacy-cuts",
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals,
      questions: [],
      audit: [],
    });
    const imported = await importHandoffV2(f.registered, handoff, f.sourceBytes);
    const scope = { startMs: 1000, endMs: 1750 };
    const decisions = proposals.map((claim) => ({
      handoffId: handoff.handoffId,
      claimId: claim.id,
      disposition: "modified" as const,
      modifiedClaim: { ...claim, scope },
    }));
    const reviewed = await decideSectionV2(
      imported.document,
      { humanId: "expert", decisions },
      f.sourceBytes,
    );
    expect(reviewed.reviewRevision).toBe(imported.document.reviewRevision + 1);
    expect(reviewed.observations.map((entry) => entry.claim.scope)).toEqual([scope, scope]);
    expect(reviewed.handoffs).toEqual(imported.document.handoffs);
    await expect(assertReviewDocumentV2(reviewed, f.sourceBytes)).resolves.toEqual(reviewed);
    const distinct = await sealHandoffV2(f.task, {
      handoffId: "distinct-sections",
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals: proposals.map((claim, index) => ({
        ...claim,
        sectionId: `section-${index}`,
        scope,
      })),
      questions: [],
      audit: [],
    });
    const separate = await importHandoffV2(f.registered, distinct, f.sourceBytes);
    await expect(
      decideSectionV2(
        separate.document,
        {
          humanId: "expert",
          decisions: distinct.proposals.map((claim) => ({
            handoffId: distinct.handoffId,
            claimId: claim.id,
            disposition: "accepted",
          })),
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("Original section identity");
  });

  it("saves and revises direct section dimensions without requiring human prose while agents remain strict", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const directClaims: ClaimV2[] = ["jumpstream", "longjack"].map((tagId) => ({
      ...f.claim,
      id: `direct-${tagId}`,
      tagId,
      evidence: { ...f.claim.evidence, rationale: "" },
    }));
    const saved = await decideSectionV2(
      imported.document,
      {
        humanId: "expert",
        decisions: [
          { handoffId: f.handoff.handoffId, claimId: f.claim.id, disposition: "accepted" },
        ],
        observations: directClaims,
      },
      f.sourceBytes,
    );
    const direct = saved.observations.filter((entry) => entry.origin.kind === "direct-human");
    expect(direct.map((entry) => entry.claim.evidence.rationale)).toEqual(["", ""]);
    await expect(assertReviewDocumentV2(saved, f.sourceBytes)).resolves.toEqual(saved);
    const revised = await decideSectionV2(
      saved,
      {
        humanId: "expert",
        decisions: [],
        observations: directClaims.map((claim) => ({
          ...claim,
          assessment: { presence: "absent" },
        })),
        supersedesObservationIds: Object.fromEntries(
          direct.map((entry) => [entry.claim.id, entry.id]),
        ),
      },
      f.sourceBytes,
    );
    expect(revised.reviewRevision).toBe(saved.reviewRevision + 1);
    expect(revised.decisions).toEqual(saved.decisions);
    expect(
      effectiveHumanObservationsV2(revised).filter((entry) => entry.origin.kind === "direct-human"),
    ).toEqual(
      expect.arrayContaining(
        directClaims.map((claim) =>
          expect.objectContaining({
            claim: { ...claim, assessment: { presence: "absent" } },
          }),
        ),
      ),
    );
    await expect(assertReviewDocumentV2(revised, f.sourceBytes)).resolves.toEqual(revised);
    await expect(
      validateHandoffV2(
        { ...f.handoff, proposals: directClaims, questions: [], audit: [] },
        f.task,
      ),
    ).rejects.toThrow("claim.evidence.rationale");
    await expect(
      addHumanObservationsV2(
        saved,
        {
          humanId: "expert",
          claims: directClaims.map((claim) => ({
            ...claim,
            evidence: { ...claim.evidence, noteRefs: [] },
          })),
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("source-backed witness notes");
  });

  it("confirms a whole section once while preserving previous decisions and repeat identities", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const repeated = await importHandoffV2(
      imported.document,
      { ...f.handoff, handoffId: "another-repeat" },
      f.sourceBytes,
    );
    const partiallyReviewed = await decideClaimV2(
      repeated.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        humanId: "expert",
        disposition: "accepted",
        id: "prior-tech-decision",
      },
      f.sourceBytes,
    );
    const before = serializeCanonicalJson(partiallyReviewed);
    const speedjack = f.handoff.proposals[2];
    if (!speedjack) throw new Error("Missing speedjack fixture claim.");
    const reviewed = await decideSectionV2(
      partiallyReviewed,
      {
        id: "section-review",
        now: () => NOW,
        humanId: "expert",
        decisions: [
          {
            handoffId: f.handoff.handoffId,
            claimId: "streams-claim",
            disposition: "accepted",
            confidence: "high",
          },
          {
            handoffId: f.handoff.handoffId,
            claimId: "speedjack-claim",
            disposition: "modified",
            confidence: "low",
            modifiedClaim: {
              ...speedjack,
              assessment: { presence: "absent" },
            },
          },
        ],
        observations: ["jumpstream", "longjack"].map((tagId) => ({
          ...f.claim,
          id: `direct-${tagId}`,
          tagId,
          assessment: { presence: "absent" },
        })),
        confidences: { "direct-jumpstream": "low", "direct-longjack": "high" },
      },
      f.sourceBytes,
    );
    expect(serializeCanonicalJson(partiallyReviewed)).toBe(before);
    expect(reviewed.revision).toBe(partiallyReviewed.revision + 1);
    expect(reviewed.reviewRevision).toBe(partiallyReviewed.reviewRevision + 1);
    expect(reviewed.decisions).toHaveLength(3);
    expect(reviewed.decisions[0]).toEqual(partiallyReviewed.decisions[0]);
    expect(reviewed.observations[0]).toEqual(partiallyReviewed.observations[0]);
    expect(reviewed.observations.map((entry) => entry.confidence)).toEqual([
      undefined,
      "high",
      "low",
      "low",
      "high",
    ]);
    expect(effectiveHumanObservationsV2(reviewed)).toHaveLength(5);
    expect(reviewed.observations.slice(1).every((entry) => entry.confirmedAt === NOW)).toBe(true);
    expect(
      (await readAgentReviewsV2(reviewed)).filter((row) => row.handoffId === "another-repeat"),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ status: "awaiting-audit" })]));
    await expect(assertReviewDocumentV2(reviewed, f.sourceBytes)).resolves.toEqual(reviewed);
  });

  it("keeps section submissions within one rate, source scope, tag set, and handoff", async () => {
    const f = await workflowFixture();
    const halfRate = {
      ...f.handoff,
      proposals: f.handoff.proposals.map((claim) => ({ ...claim, playbackRate: 0.5 as const })),
    };
    const imported = await importHandoffV2(f.registered, halfRate, f.sourceBytes);
    const another = await importHandoffV2(
      imported.document,
      { ...halfRate, handoffId: "other-repeat" },
      f.sourceBytes,
    );
    const decisions = halfRate.proposals.slice(0, 2).map((claim) => ({
      handoffId: halfRate.handoffId,
      claimId: claim.id,
      disposition: "accepted" as const,
    }));
    const [firstDecision, secondDecision] = decisions;
    const secondClaim = halfRate.proposals[1];
    if (!firstDecision || !secondDecision || !secondClaim)
      throw new Error("Missing section fixture.");
    const valid = await decideSectionV2(
      another.document,
      { humanId: "expert", decisions },
      f.sourceBytes,
    );
    expect(valid.observations.every((entry) => entry.claim.playbackRate === 0.5)).toBe(true);
    await expect(
      decideSectionV2(
        another.document,
        {
          humanId: "expert",
          decisions: [firstDecision, { ...secondDecision, handoffId: "other-repeat" }],
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("single handoff");
    await expect(
      decideSectionV2(
        another.document,
        { humanId: "expert", decisions: [firstDecision, firstDecision] },
        f.sourceBytes,
      ),
    ).rejects.toThrow("each original claim once");
    for (const changed of [
      { ...secondClaim, playbackRate: 1.5 as const },
      { ...secondClaim, scope: { startMs: 1000, endMs: 1700 } },
    ]) {
      await expect(
        decideSectionV2(
          another.document,
          {
            humanId: "expert",
            decisions: [
              firstDecision,
              { ...secondDecision, disposition: "modified", modifiedClaim: changed },
            ],
          },
          f.sourceBytes,
        ),
      ).rejects.toThrow(/playback rate|source-time scope/);
    }
  });

  it("revises all five direct assessments in one append while retaining unresolved semantics", async () => {
    const f = await workflowFixture();
    const claims = f.foundation.tags.map((tag) => ({
      ...f.claim,
      id: tag.id,
      tagId: tag.id,
      playbackRate: 1.5 as const,
    }));
    const original = await addHumanObservationsV2(
      f.registered,
      { humanId: "expert", claims, id: "direct-initial" },
      f.sourceBytes,
    );
    const supersedesObservationIds = Object.fromEntries(
      original.observations.map((entry) => [entry.claim.id, entry.id]),
    );
    const revised = await addHumanObservationsV2(
      original,
      {
        humanId: "expert",
        id: "direct-revision",
        claims: claims.map((claim, index) => ({
          ...claim,
          assessment: { presence: index === 0 ? "unresolved" : "absent" },
        })),
        supersedesObservationIds,
      },
      f.sourceBytes,
    );
    expect(revised.revision).toBe(original.revision + 1);
    expect(revised.reviewRevision).toBe(original.reviewRevision + 1);
    expect(revised.observations.slice(0, 5)).toEqual(original.observations);
    expect(effectiveHumanObservationsV2(revised)).toEqual(revised.observations.slice(5));
    expect(effectiveHumanObservationsV2(revised)[0]?.claim.assessment).toEqual({
      presence: "unresolved",
    });
    await expect(assertReviewDocumentV2(revised, f.sourceBytes)).resolves.toEqual(revised);
    await expect(
      addHumanObservationsV2(
        revised,
        { humanId: "expert", claims, supersedesObservationIds },
        f.sourceBytes,
      ),
    ).rejects.toThrow("current direct-human");
    await expect(
      addHumanObservationsV2(
        original,
        {
          humanId: "expert",
          claims: claims.map((claim) => ({ ...claim, playbackRate: 1 })),
          supersedesObservationIds,
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("playback rate");
  });

  it("includes independent auditor evidence in confidence without rerouting audited claims", async () => {
    const f = await workflowFixture();
    const human = await addHumanObservationV2(
      f.registered,
      { claim: f.claim, humanId: "expert", id: "audit-evidence" },
      f.sourceBytes,
    );
    const observation = human.observations[0];
    if (!observation) throw new Error("Missing audit evidence observation.");
    const handoff = await sealHandoffV2(f.task, {
      handoffId: "tracked-labeler",
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals: [f.claim],
      questions: [],
      audit: [],
      humanEvidenceRefs: [],
    });
    const imported = await importHandoffV2(human, handoff, f.sourceBytes);
    expect((await handoffTrustV2(imported.document, handoff.handoffId)).humanContext).toBe(
      "current",
    );
    const auditInput = {
      auditId: "legacy-auditor",
      createdAt: NOW,
      agent: { producerId: "independent-auditor", role: "auditor" as const },
      claims: [
        {
          claimId: f.claim.id,
          outcome: "supported" as const,
          rationale: "Independent source inspection.",
        },
      ],
      questions: [],
    };
    const legacy = await sealAuditV2(f.task, handoff, auditInput);
    const legacyImported = await importAuditV2(imported.document, legacy, f.sourceBytes);
    expect((await handoffTrustV2(legacyImported.document, handoff.handoffId)).humanContext).toBe(
      "untracked",
    );
    const humanEvidenceRefs = [
      {
        sourceSha256: f.task.source.sha256,
        observationId: observation.id,
        observationSha256: await hashWorkflowValueV2(observation),
      },
    ];
    const audit = await sealAuditV2(f.task, handoff, {
      ...auditInput,
      auditId: "tracked-auditor",
      humanEvidenceRefs,
    });
    expect(audit.humanEvidenceRefs).toEqual(humanEvidenceRefs);
    const tracked = await importAuditV2(imported.document, audit, f.sourceBytes);
    expect((await handoffTrustV2(tracked.document, handoff.handoffId)).humanContext).toBe(
      "current",
    );
    const mixed = await importAuditV2(legacyImported.document, audit, f.sourceBytes);
    expect((await handoffTrustV2(mixed.document, handoff.handoffId)).humanContext).toBe(
      "untracked",
    );
    const revised = await addHumanObservationV2(
      mixed.document,
      {
        claim: { ...f.claim, assessment: { presence: "absent" } },
        humanId: "expert",
        supersedesObservationId: observation.id,
      },
      f.sourceBytes,
    );
    expect(await handoffTrustV2(revised, handoff.handoffId)).toEqual({
      source: "current",
      foundation: "current",
      humanContext: "changed",
    });
    expect((await readAgentReviewsV2(revised))[0]?.status).toBe("agent-reviewed");
    const foundationChanged = {
      ...tracked.document,
      foundation: {
        ...tracked.document.foundation,
        revision: tracked.document.foundation.revision + 1,
      },
    };
    expect(await handoffTrustV2(foundationChanged, handoff.handoffId)).toEqual({
      source: "current",
      foundation: "changed",
      humanContext: "changed",
    });
    await expect(
      validateAuditV2(
        {
          ...audit,
          humanEvidenceRefs: [{ ...humanEvidenceRefs[0], observationSha256: "invalid" }],
        },
        f.task,
        handoff,
      ),
    ).rejects.toThrow("SHA-256");
  });
  it("keeps other sections reviewable after a decision and ignores historical imported stale flags", async () => {
    const f = await workflowFixture();
    const first = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const second = await importHandoffV2(
      first.document,
      { ...f.handoff, handoffId: "other-section" },
      f.sourceBytes,
    );
    const decided = await decideClaimV2(
      second.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "accepted",
        humanId: "expert",
      },
      f.sourceBytes,
    );
    const legacy = {
      ...decided,
      handoffs: decided.handoffs.map((entry) => ({ ...entry, baseStatus: "stale" as const })),
    };
    expect(
      (await readAgentReviewsV2(legacy))
        .filter((row) => row.handoffId === "other-section")
        .every((row) => row.status === "awaiting-audit" && row.baseStatus === "current"),
    ).toBe(true);
    expect(legacy.decisions).toHaveLength(1);
  });

  it("appends human corrections and only exports the latest effective judgment", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const input = { handoffId: f.handoff.handoffId, claimId: f.claim.id, humanId: "expert" };
    const accepted = await decideClaimV2(
      imported.document,
      { ...input, disposition: "accepted", id: "accept" },
      f.sourceBytes,
    );
    const modified = await decideClaimV2(
      accepted,
      {
        ...input,
        disposition: "modified",
        id: "correct",
        modifiedClaim: { ...f.claim, assessment: { presence: "absent" } },
      },
      f.sourceBytes,
    );
    expect(modified.decisions.slice(0, 1)).toEqual(accepted.decisions);
    expect(modified.observations.slice(0, 1)).toEqual(accepted.observations);
    expect(effectiveHumanObservationsV2(modified).map((row) => row.id)).toEqual([
      "correct:observation",
    ]);
    expect((await readDispositionsV2(modified)).effectiveObservations[0]?.claim.assessment).toEqual(
      { presence: "absent" },
    );
    await expect(assertReviewDocumentV2(modified, f.sourceBytes)).resolves.toEqual(modified);
    const withdrawn = await decideClaimV2(
      modified,
      { ...input, disposition: "rejected", id: "withdraw" },
      f.sourceBytes,
    );
    expect(withdrawn.observations).toHaveLength(2);
    expect(effectiveHumanObservationsV2(withdrawn)).toEqual([]);
  });

  it("revises direct observations through a linear append-only history", async () => {
    const f = await workflowFixture();
    const original = await addHumanObservationV2(
      f.registered,
      { claim: f.claim, humanId: "expert", id: "initial" },
      f.sourceBytes,
    );
    const originalObservation = original.observations[0];
    if (!originalObservation) throw new Error("Missing original observation.");
    const originalId = originalObservation.id;
    const corrected = await addHumanObservationsV2(
      original,
      {
        claims: [{ ...f.claim, assessment: { presence: "unresolved" } }],
        humanId: "expert",
        id: "revision",
        supersedesObservationId: originalId,
      },
      f.sourceBytes,
    );
    expect(corrected.observations).toHaveLength(2);
    expect(effectiveHumanObservationsV2(corrected)).toEqual([corrected.observations[1]]);
    await expect(assertReviewDocumentV2(corrected, f.sourceBytes)).resolves.toEqual(corrected);
    await expect(
      addHumanObservationV2(
        corrected,
        { claim: f.claim, humanId: "expert", supersedesObservationId: originalId },
        f.sourceBytes,
      ),
    ).rejects.toThrow("current direct-human");
    const revision = corrected.observations[1];
    if (!revision) throw new Error("Missing revision observation.");
    const forged = {
      ...corrected,
      observations: [{ ...originalObservation, supersedesObservationId: revision.id }, revision],
    };
    await expect(assertReviewDocumentV2(forged, f.sourceBytes)).rejects.toThrow(
      "preceding current",
    );
  });

  it("separates changed source and Foundation from human context and requires explicit Foundation review", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const changed = {
      ...imported.document,
      foundation: {
        ...imported.document.foundation,
        revision: imported.document.foundation.revision + 1,
        tags: imported.document.foundation.tags.map((tag) => ({
          ...tag,
          definition: `${tag.definition} Updated definition.`,
        })),
      },
    };
    expect(await handoffTrustV2(changed, f.handoff.handoffId)).toEqual({
      source: "current",
      foundation: "changed",
      humanContext: "untracked",
    });
    const input = { handoffId: f.handoff.handoffId, claimId: f.claim.id, humanId: "expert" };
    await expect(
      decideClaimV2(changed, { ...input, disposition: "accepted" }, f.sourceBytes),
    ).rejects.toThrow("explicitly revise");
    const reviewed = await decideClaimV2(
      changed,
      { ...input, disposition: "modified", modifiedClaim: f.claim },
      f.sourceBytes,
    );
    expect(reviewed.observations[0]?.foundationSha256).toBe(
      await hashWorkflowValueV2(changed.foundation),
    );
    expect(reviewed.handoffs).toEqual(imported.document.handoffs);
    await expect(assertReviewDocumentV2(reviewed, f.sourceBytes)).resolves.toEqual(reviewed);
    expect(
      (
        await handoffTrustV2(
          { ...changed, source: { ...changed.source, sha256: "f".repeat(64) } },
          f.handoff.handoffId,
        )
      ).source,
    ).toBe("changed");
  });

  it("preserves exact human evidence references and reports revised evidence without invalidating claims", async () => {
    const f = await workflowFixture();
    const human = await addHumanObservationV2(
      f.registered,
      { claim: f.claim, humanId: "expert", id: "reference" },
      f.sourceBytes,
    );
    const observation = human.observations[0];
    if (!observation) throw new Error("Missing evidence observation.");
    const humanEvidenceRefs = [
      {
        sourceSha256: f.task.source.sha256,
        observationId: observation.id,
        observationSha256: await hashWorkflowValueV2(observation),
      },
    ];
    const handoff = await sealHandoffV2(f.task, {
      handoffId: "referenced",
      createdAt: NOW,
      agent: f.handoff.agent,
      proposals: [f.claim],
      audit: [],
      questions: [],
      humanEvidenceRefs,
    });
    expect(handoff.humanEvidenceRefs).toEqual(humanEvidenceRefs);
    const imported = await importHandoffV2(human, handoff, f.sourceBytes);
    expect((await handoffTrustV2(imported.document, handoff.handoffId)).humanContext).toBe(
      "current",
    );
    const revised = await addHumanObservationV2(
      imported.document,
      {
        claim: { ...f.claim, assessment: { presence: "absent" } },
        humanId: "expert",
        supersedesObservationId: observation.id,
      },
      f.sourceBytes,
    );
    expect((await handoffTrustV2(revised, handoff.handoffId)).humanContext).toBe("changed");
    expect((await readAgentReviewsV2(revised))[0]?.status).toBe("awaiting-audit");
    await expect(
      validateHandoffV2(
        {
          ...handoff,
          humanEvidenceRefs: [{ ...humanEvidenceRefs[0], observationSha256: "invalid" }],
        },
        f.task,
      ),
    ).rejects.toThrow("SHA-256");
  });

  it("requires explicit presence for new confirmations while preserving historical uncertain acceptances", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const unresolved = f.handoff.proposals[2];
    if (!unresolved) throw new Error("Missing unresolved fixture.");
    const input = {
      handoffId: f.handoff.handoffId,
      claimId: unresolved.id,
      humanId: "human",
      rationale: "Explicit review.",
    };
    await expect(
      decideClaimV2(imported.document, { ...input, disposition: "accepted" }, f.sourceBytes),
    ).rejects.toThrow("Choose present with salience or absent");
    await expect(
      decideClaimV2(
        imported.document,
        {
          ...input,
          disposition: "modified",
          modifiedClaim: { ...unresolved, assessment: { presence: "unreviewed" } },
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("Choose present with salience or absent");
    const deferred = await decideClaimV2(
      imported.document,
      { ...input, disposition: "deferred" },
      f.sourceBytes,
    );
    expect(deferred.observations).toEqual([]);
    const clarifiedClaim: ClaimV2 = {
      ...unresolved,
      assessment: { presence: "present", salience: "supporting" },
    };
    const modified = await decideClaimV2(
      deferred,
      { ...input, disposition: "modified", modifiedClaim: clarifiedClaim },
      f.sourceBytes,
    );
    expect(modified.observations[0]?.claim).toEqual(clarifiedClaim);
    const historical = historicalAcceptance(imported.document, f.handoff.handoffId, unresolved.id);
    const bytes = serializeCanonicalJson(historical);
    expect(
      serializeCanonicalJson(await assertReviewDocumentV2(JSON.parse(bytes), f.sourceBytes)),
    ).toBe(bytes);
    const clarified = await addHumanObservationV2(
      historical,
      { claim: clarifiedClaim, humanId: "human", now: () => "2026-09-05T01:00:00.000Z" },
      f.sourceBytes,
    );
    expect(clarified.decisions).toEqual(historical.decisions);
    expect(clarified.observations[0]).toEqual(historical.observations[0]);
    expect(clarified.observations[1]?.claim.assessment).toEqual({
      presence: "present",
      salience: "supporting",
    });
  });

  it("retains legacy singular correspondence bytes and pinned hashes when reopening existing snapshots", async () => {
    const f = await workflowFixture();
    const root = new FakeDirectoryHandle();
    const workflow = await root.getDirectoryHandle("workflow", { create: true });
    const file = await workflow.getFileHandle(`${f.inspected.source.sha256}.v2.json`, {
      create: true,
    });
    const original = serializeCanonicalJson(f.registered);
    file.setText(original);
    const reopened = await new WorkflowDirectoryV2(root).read(
      f.inspected.source.sha256,
      f.sourceBytes,
    );

    expect(serializeCanonicalJson(reopened?.document)).toBe(original);
    expect(await (await file.getFile()).text()).toBe(original);
    expect(await hashWorkflowValueV2(reopened?.document.foundation)).toBe(
      "086b4d74eb8d49b19a6b311cd21550e08c150cd1c2cc2173c05afcc70c9973d0",
    );
    expect(reopened?.document.tasks[0]?.taskSha256).toBe(
      "ef6575aa3630fb5e780c794ae110c611ac3c7b7a77673a71cb505e90df827fb6",
    );
    expect(
      reopened?.document.foundation.tags.every(
        (tag) => "communityAlignment" in tag && !("communityAlignments" in tag),
      ),
    ).toBe(true);
  });

  it("accepts missing, empty and multiple correspondences without turning them into section judgments", async () => {
    const f = await workflowFixture();
    const pilot = createExperimentalFoundationV2(NOW);
    const links: readonly CommunityAlignmentV2[] = [
      {
        catalogueUrl: "https://example.com/catalogue",
        externalTagId: "synthetic/community-a",
        relation: "related",
        scope: "One candidate relationship; no automatic training equivalence.",
      },
      {
        catalogueUrl: "https://example.com/catalogue",
        externalTagId: "synthetic/community-b",
        relation: "broader",
        scope: "A second scoped relationship requiring a separate consumer decision.",
      },
    ];
    const foundation: FoundationV2 = {
      ...pilot,
      tags: pilot.tags.map(({ communityAlignment: _, communityAlignments: __, ...tag }, index) =>
        index === 0 ? tag : { ...tag, communityAlignments: index === 1 ? [] : links },
      ),
    };
    await expect(assertFoundationV2(foundation)).resolves.toEqual(foundation);
    const root = new FakeDirectoryHandle();
    const directory = new WorkflowDirectoryV2(root);
    const initial = await directory.initialize(f.sourceBytes, foundation);
    const exported = await directory.exportTask(f.sourceBytes, initial.version);
    const reopened = await new WorkflowDirectoryV2(root).read(
      f.inspected.source.sha256,
      f.sourceBytes,
    );
    expect(reopened?.document.foundation).toEqual(foundation);
    expect((await assertTaskPacketV2(exported.task)).foundation).toEqual(foundation);
    expect(reopened?.document.observations).toEqual([]);
    expect(reopened?.document.foundation.tags.map((tag) => tag.id)).toEqual(
      pilot.tags.map((tag) => tag.id),
    );
  });

  it("rejects ambiguous singular and plural correspondence declarations", async () => {
    const f = await workflowFixture();
    await expect(
      assertFoundationV2({
        ...f.foundation,
        tags: f.foundation.tags.map((tag) => ({ ...tag, communityAlignments: [] })),
      }),
    ).rejects.toThrow("both");
  });

  it("round-trips mixed independent assessments with per-claim witnesses, entry occupancy, boundaries and transitions", async () => {
    const f = await workflowFixture();
    const claims: ClaimV2[] = [
      f.claim,
      { ...f.claim, id: "streams", tagId: "streams" },
      {
        ...f.claim,
        id: "absent",
        tagId: "jumpstream",
        assessment: { presence: "absent" },
        evidence: {
          noteRefs: [],
          contextNoteRefs: [],
          rationale: "I inspected the arrangement and found no jumpstream.",
        },
      },
      { ...f.claim, id: "uncertain", tagId: "speedjack", assessment: { presence: "unresolved" } },
      {
        id: "unreviewed",
        sectionId: "mixed-section",
        tagId: "longjack",
        scope: f.claim.scope,
        reviewContext: f.claim.reviewContext,
        assessment: { presence: "unreviewed" },
        evidence: { noteRefs: [], contextNoteRefs: [], rationale: "" },
      },
    ];
    const document = await addHumanObservationsV2(
      f.document,
      { claims, humanId: "expert" },
      f.sourceBytes,
    );
    const restored = await assertReviewDocumentV2(
      JSON.parse(serializeCanonicalJson(document)),
      f.sourceBytes,
    );
    expect(restored.observations.map((entry) => entry.claim)).toEqual(claims);
    expect(
      restored.observations.filter((entry) => entry.claim.assessment.presence === "present"),
    ).toHaveLength(2);
    expect(restored.observations[0]?.claim.evidence.noteRefs[0]?.startMs).toBeLessThan(
      f.claim.scope.startMs,
    );
  });

  it("freezes complete exact source facts and keeps task registration outside the human task base", async () => {
    const f = await workflowFixture();
    expect(await baseForTaskV2(f.registered)).toEqual(f.task.base);
    expect(f.task.structure.notes).toHaveLength(6);
    expect(f.task.structure.timingPoints[0]?.fields[1]).toBe("500");
    expect(await assertTaskPacketV2(JSON.parse(JSON.stringify(f.task)))).toEqual(f.task);
    await expect(
      assertTaskPacketV2({
        ...f.task,
        structure: { ...f.task.structure, notes: f.task.structure.notes.slice(1) },
      }),
    ).rejects.toThrow("structure");
  });

  it("accepts independent siblings, defers one and preserves originals across duplicate exchanges", async () => {
    const f = await workflowFixture();
    let result = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    expect(result.baseStatus).toBe("current");
    let document = await decideClaimV2(
      result.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "accepted",
        humanId: "expert",
        rationale: "Confirmed.",
      },
      f.sourceBytes,
    );
    document = await decideClaimV2(
      document,
      {
        handoffId: f.handoff.handoffId,
        claimId: "streams-claim",
        disposition: "modified",
        modifiedClaim: {
          ...f.claim,
          id: "streams-claim",
          tagId: "streams",
          assessment: { presence: "present", salience: "supporting" },
        },
        humanId: "expert",
        rationale: "Present with supporting salience.",
      },
      f.sourceBytes,
    );
    document = await decideClaimV2(
      document,
      {
        handoffId: f.handoff.handoffId,
        claimId: "speedjack-claim",
        disposition: "deferred",
        humanId: "expert",
        rationale: "Needs calibration.",
      },
      f.sourceBytes,
    );
    result = await importHandoffV2(document, f.handoff, f.sourceBytes);
    expect(result.status).toBe("duplicate");
    expect(result.document).toBe(document);
    expect(document.handoffs[0]?.handoff).toEqual(f.handoff);
    expect(document.observations).toHaveLength(2);
    expect(document.decisions.map((decision) => decision.disposition)).toEqual([
      "accepted",
      "modified",
      "deferred",
    ]);
    expect(
      (await readDispositionsV2(document)).handoffs[0]?.claims[2]?.decisions[0]?.disposition,
    ).toBe("deferred");
    await expect(assertReviewDocumentV2(document, f.sourceBytes)).resolves.toEqual(document);
  });

  it("keeps human context changes separate from packet integrity and permits explicit human review", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const human = await addHumanObservationV2(
      imported.document,
      { claim: f.claim, humanId: "expert" },
      f.sourceBytes,
    );
    expect(await handoffBaseStatusV2(human, f.handoff.handoffId)).toBe("current");
    expect((await handoffTrustV2(human, f.handoff.handoffId)).humanContext).toBe("untracked");
    expect((await readDispositionsV2(human)).handoffs[0]?.baseStatus).toBe("current");
    await expect(
      decideClaimV2(
        human,
        {
          handoffId: f.handoff.handoffId,
          claimId: f.claim.id,
          disposition: "accepted",
          humanId: "expert",
          rationale: "",
        },
        f.sourceBytes,
      ),
    ).resolves.toMatchObject({ decisions: [{ disposition: "accepted" }] });
    const lateResult = await importHandoffV2(
      human,
      { ...f.handoff, handoffId: "late" },
      f.sourceBytes,
    );
    expect(lateResult.baseStatus).toBe("current");
    expect(lateResult.document.observations).toEqual(human.observations);
  });

  it("keeps rejection separate from negative and lets a human resolve a deferred claim", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const rejected = await decideClaimV2(
      imported.document,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "rejected",
        humanId: "expert",
        rationale: "The proposed concept is not supported by this evidence.",
      },
      f.sourceBytes,
    );
    expect(rejected.observations).toEqual([]);
    const deferred = await decideClaimV2(
      rejected,
      {
        handoffId: f.handoff.handoffId,
        claimId: "streams-claim",
        disposition: "deferred",
        humanId: "expert",
        rationale: "Return after checking the previous phrase.",
      },
      f.sourceBytes,
    );
    const resolved = await decideClaimV2(
      deferred,
      {
        handoffId: f.handoff.handoffId,
        claimId: "streams-claim",
        disposition: "accepted",
        humanId: "expert",
        rationale: "Context checked.",
      },
      f.sourceBytes,
    );
    expect(resolved.decisions).toHaveLength(3);
    expect(resolved.observations).toHaveLength(1);
    await expect(
      decideClaimV2(
        resolved,
        {
          handoffId: f.handoff.handoffId,
          claimId: f.claim.id,
          disposition: "accepted",
          humanId: "expert",
          rationale: "",
        },
        f.sourceBytes,
      ),
    ).resolves.toMatchObject({
      decisions: [...resolved.decisions, expect.objectContaining({ disposition: "accepted" })],
    });
  });

  it("rejects human authority fields, forged evidence and mismatched source at the actual handoff boundary", async () => {
    const f = await workflowFixture();
    await expect(validateHandoffV2({ ...f.handoff, decisions: [] }, f.task)).rejects.toThrow(
      "not an allowed field",
    );
    await expect(
      validateHandoffV2({ ...f.handoff, proposals: [{ ...f.claim, humanId: "forged" }] }, f.task),
    ).rejects.toThrow("not an allowed field");
    await expect(
      importHandoffV2(f.registered, { ...f.handoff, sourceSha256: "f".repeat(64) }, f.sourceBytes),
    ).rejects.toThrow("Source mismatch");
    await expect(
      validateHandoffV2(
        {
          ...f.handoff,
          proposals: [
            {
              ...f.claim,
              evidence: { ...f.claim.evidence, noteRefs: [{ ...f.refs[0], startMs: 0 }] },
            },
          ],
        },
        f.task,
      ),
    ).rejects.toThrow("does not resolve");
    await expect(
      addHumanObservationV2(f.proposed, { claim: f.claim, humanId: "expert" }, f.sourceBytes),
    ).rejects.toThrow("approve the Foundation");
  });
});
