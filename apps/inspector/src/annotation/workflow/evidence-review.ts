import { serializeCanonicalJson } from "../canonical-json";
import { stableNoteRefKey } from "../stable-note-ref";
import type { ClaimV2, EvidenceReviewV2, HumanObservationV2 } from "./contracts";

export function newEvidenceReview(
  origin: EvidenceReviewV2["selectionOrigin"],
  source: Pick<EvidenceReviewV2, "sourceHandoffId" | "sourceObservationId" | "sourceClaimId"> = {},
): EvidenceReviewV2 {
  return {
    selectionOrigin: origin,
    ...source,
    operations: [],
  };
}

export function inheritedHumanEvidenceReview(observation: HumanObservationV2): EvidenceReviewV2 {
  return newEvidenceReview("inherited-human", {
    sourceObservationId: observation.id,
    sourceClaimId: observation.claim.id,
  });
}

export function recordEvidenceOperation(
  review: EvidenceReviewV2,
  operation: EvidenceReviewV2["operations"][number],
): EvidenceReviewV2 {
  return {
    ...review,
    ...(review.selectionReviewed === undefined ? {} : { selectionReviewed: false }),
    ...(review.rationaleReviewed === undefined ? {} : { rationaleReviewed: false }),
    operations: [
      ...review.operations.filter(
        (previous) => previous.kind !== operation.kind || previous.target !== operation.target,
      ),
      operation,
    ],
  };
}

/** References are sets; reordering them alone does not invalidate an explanation. */
function selectionKey(claim: ClaimV2): string {
  return serializeCanonicalJson({
    scope: claim.scope,
    reviewContext: claim.reviewContext,
    assessment: claim.assessment,
    playbackRate: claim.playbackRate ?? 1,
    witnesses: claim.evidence.noteRefs.map(stableNoteRefKey).sort(),
    context: claim.evidence.contextNoteRefs.map(stableNoteRefKey).sort(),
  });
}

export function updateEvidenceDraft(
  previous: ClaimV2,
  next: ClaimV2,
  review: EvidenceReviewV2,
): { claim: ClaimV2; review: EvidenceReviewV2 } {
  const changed = selectionKey(previous) !== selectionKey(next);
  const rationaleChanged = previous.evidence.rationale !== next.evidence.rationale;
  return {
    claim:
      changed && !rationaleChanged
        ? { ...next, evidence: { ...next.evidence, rationale: "" } }
        : next,
    review: changed
      ? {
          ...review,
          ...(review.selectionReviewed === undefined ? {} : { selectionReviewed: false }),
          ...(review.rationaleReviewed === undefined ? {} : { rationaleReviewed: false }),
        }
      : rationaleChanged
        ? {
            ...review,
            ...(review.rationaleReviewed === undefined ? {} : { rationaleReviewed: false }),
          }
        : review,
  };
}
