import { describe, expect, it } from "vitest";
import type { ClaimV2 } from "./contracts";
import {
  addHumanObservationsV2,
  assertReviewDocumentV2,
  decideClaimV2,
  importHandoffV2,
} from "./domain";
import {
  inheritedHumanEvidenceReview,
  newEvidenceReview,
  recordEvidenceOperation,
  updateEvidenceDraft,
} from "./evidence-review";
import { historicalAcceptance, workflowFixture } from "./test-fixtures";

describe("human selection provenance and legacy review metadata", () => {
  it("round-trips legacy explicit-review fields while new revisions only record selection provenance", async () => {
    const f = await workflowFixture();
    const imported = await importHandoffV2(f.registered, f.handoff, f.sourceBytes);
    const historical = historicalAcceptance(imported.document, f.handoff.handoffId, f.claim.id);
    const historyBytes = JSON.stringify(historical);
    expect(
      (await assertReviewDocumentV2(historical, f.sourceBytes)).observations[0]?.evidenceReview,
    ).toBeUndefined();
    expect(JSON.stringify(historical)).toBe(historyBytes);
    const original = historical.observations[0];
    if (!original) throw new Error("Missing historical observation.");
    const reviewed = await decideClaimV2(
      historical,
      {
        handoffId: f.handoff.handoffId,
        claimId: f.claim.id,
        disposition: "accepted",
        humanId: "new-reviewer",
        evidenceReview: {
          ...inheritedHumanEvidenceReview(original),
          selectionReviewed: true,
          rationaleReviewed: true,
        },
      },
      f.sourceBytes,
    );
    expect(reviewed.observations[0]).toEqual(original);
    expect(reviewed.observations.at(-1)?.claim).toEqual(original.claim);
    expect(reviewed.observations.at(-1)?.evidenceReview).toMatchObject({
      selectionOrigin: "inherited-human",
      sourceObservationId: original.id,
      selectionReviewed: true,
      rationaleReviewed: true,
    });
    await expect(assertReviewDocumentV2(reviewed, f.sourceBytes)).resolves.toEqual(reviewed);
    const saved = reviewed.observations.at(-1);
    if (!saved) throw new Error("Missing new observation.");
    expect(inheritedHumanEvidenceReview(saved)).toEqual({
      selectionOrigin: "inherited-human",
      sourceObservationId: saved.id,
      sourceClaimId: saved.claim.id,
      operations: [],
    });
    expect(reviewed.handoffs).toEqual(historical.handoffs);
  });

  it("saves source operations for each direct dimension without claiming dedicated review", async () => {
    const f = await workflowFixture();
    const claims = [f.claim, { ...f.claim, id: "stream-claim", tagId: "streams" }];
    const auto = recordEvidenceOperation(newEvidenceReview("new-human"), {
      kind: "auto-scope-fill",
      target: "witness",
    });
    const explicit = recordEvidenceOperation(newEvidenceReview("new-human"), {
      kind: "explicit-scope-selection",
      target: "witness",
    });
    const reviewed = await addHumanObservationsV2(
      f.registered,
      {
        humanId: "human",
        claims,
        evidenceReviews: { [f.claim.id]: auto, "stream-claim": explicit },
      },
      f.sourceBytes,
    );
    expect(reviewed.observations.map((observation) => observation.evidenceReview)).toEqual([
      auto,
      explicit,
    ]);
    await expect(assertReviewDocumentV2(reviewed, f.sourceBytes)).resolves.toEqual(reviewed);
    await expect(
      addHumanObservationsV2(
        f.registered,
        {
          humanId: "human",
          claims: [{ ...f.claim, evidence: { ...f.claim.evidence, rationale: "" } }],
          evidenceReviews: { [f.claim.id]: { ...auto, rationaleReviewed: true } },
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("reviewed rationale requires a current explanation");
    await expect(
      addHumanObservationsV2(
        f.registered,
        {
          humanId: "human",
          claims: [f.claim],
          evidenceReviews: {
            [f.claim.id]: newEvidenceReview("inherited-human", {
              sourceObservationId: "missing",
              sourceClaimId: f.claim.id,
            }),
          },
        },
        f.sourceBytes,
      ),
    ).rejects.toThrow("preceding observation and claim");
  });

  it("invalidates inherited explanations for assessment, range and evidence changes, preserving replacement prose", async () => {
    const { claim } = await workflowFixture();
    const review = {
      ...newEvidenceReview("unknown"),
      selectionReviewed: true,
      rationaleReviewed: true,
    };
    const changes: Partial<ClaimV2>[] = [
      { assessment: { presence: "absent" } },
      { scope: { ...claim.scope, startMs: 1100 } },
      { reviewContext: { ...claim.reviewContext, startMs: 100 } },
      { evidence: { ...claim.evidence, noteRefs: claim.evidence.noteRefs.slice(1) } },
      { evidence: { ...claim.evidence, contextNoteRefs: [] } },
    ];
    for (const change of changes) {
      const next = { ...claim, ...change };
      expect(updateEvidenceDraft(claim, next, review)).toMatchObject({
        claim: { evidence: { rationale: "" } },
        review: { selectionReviewed: false, rationaleReviewed: false },
      });
      const replacement = {
        ...next,
        evidence: { ...next.evidence, rationale: "New explanation for this edited judgment." },
      };
      expect(updateEvidenceDraft(claim, replacement, review).claim).toEqual(replacement);
    }
    expect(claim.evidence.rationale).not.toBe("");
    const rewritten = updateEvidenceDraft(
      claim,
      { ...claim, evidence: { ...claim.evidence, rationale: "Reworded explanation." } },
      review,
    );
    expect(rewritten.review).toMatchObject({ selectionReviewed: true, rationaleReviewed: false });
    expect(
      updateEvidenceDraft(
        claim,
        {
          ...claim,
          evidence: { ...claim.evidence, noteRefs: [...claim.evidence.noteRefs].reverse() },
        },
        review,
      ).review,
    ).toEqual(review);
  });

  it("keeps review flags absent when editing ordinary selection metadata", async () => {
    const { claim } = await workflowFixture();
    const next = { ...claim, assessment: { presence: "absent" as const } };
    const updated = updateEvidenceDraft(claim, next, newEvidenceReview("unknown"));
    expect(updated.claim.evidence.rationale).toBe("");
    expect(updated.review).toEqual({ selectionOrigin: "unknown", operations: [] });
    const rewritten = updateEvidenceDraft(
      claim,
      {
        ...claim,
        evidence: { ...claim.evidence, rationale: "Optional edit." },
      },
      updated.review,
    );
    expect(rewritten.review).toEqual(updated.review);
  });

  it("retains automatic and explicit selection operations without an unbounded click history", () => {
    let review = newEvidenceReview("new-human");
    for (let index = 0; index < 50; index++) {
      review = recordEvidenceOperation(review, { kind: "auto-scope-fill", target: "witness" });
      review = recordEvidenceOperation(review, {
        kind: "explicit-scope-selection",
        target: "witness",
      });
      review = recordEvidenceOperation(review, { kind: "manual-note-edit", target: "context" });
    }
    expect(review.operations).toHaveLength(3);
    expect(review).not.toHaveProperty("selectionReviewed");
    expect(review).not.toHaveProperty("rationaleReviewed");
  });
});
