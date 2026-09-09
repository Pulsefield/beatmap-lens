import type { InboxClaimV2, InboxSourceV2 } from "./remote-workspace";
import {
  matchesReviewVersions,
  type ReviewVersionFilter,
  reviewVersionKey,
} from "./review-provenance";

export const REVIEW_TARGETS: Record<string, string> = {
  "jack-organization": "Jack",
  "stream-organization": "Stream",
  tech: "Tech",
  "ln-coordination": "LN coordination",
  "trill-organization": "Trill",
};

export type SampleStrength = "all" | "absent" | "supporting" | "prominent";
export interface ReviewSampleRef {
  sourceSha256: string;
  handoffId: string;
  claimId: string;
}
export interface ReviewSampleItem {
  source: InboxSourceV2;
  claim: InboxClaimV2;
}
export interface ReviewSampleBatch extends ReviewVersionFilter {
  createdAt: string;
  tagId: string;
  strength: SampleStrength;
  claims: ReviewSampleRef[];
}

export function sampleRef(item: ReviewSampleItem): ReviewSampleRef {
  return {
    sourceSha256: item.source.source.sha256,
    handoffId: item.claim.handoffId,
    claimId: item.claim.claimId,
  };
}

export function sampleKey(ref: ReviewSampleRef): string {
  return JSON.stringify([ref.sourceSha256, ref.handoffId, ref.claimId]);
}

export function assessmentStrength(claim: InboxClaimV2): string {
  const assessment = claim.assessment;
  return assessment?.presence === "present" ? assessment.salience : (assessment?.presence ?? "");
}

export function sampleCandidates(
  sources: readonly InboxSourceV2[],
  tagId: string,
  strength: SampleStrength,
  versions: ReviewVersionFilter = {},
): ReviewSampleItem[] {
  const seen = new Set<string>();
  return sources.flatMap((source) =>
    source.reviews
      .filter((claim) => {
        const level = assessmentStrength(claim);
        const eligible =
          !["accepted", "modified", "rejected", "deferred", "superseded"].includes(claim.status) &&
          !claim.supersededBy &&
          ["absent", "supporting", "prominent"].includes(level) &&
          (!tagId || claim.tagId === tagId) &&
          (strength === "all" || level === strength) &&
          matchesReviewVersions(claim, versions) &&
          !source.requests.some(
            (request) =>
              request.handoffId === claim.handoffId &&
              request.pendingClaimIds.includes(claim.claimId),
          );
        const key = JSON.stringify([
          source.source.sha256,
          claim.scope.startMs,
          claim.scope.endMs,
          claim.tagId,
          level,
          reviewVersionKey(claim),
        ]);
        if (!eligible || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((claim) => ({ source, claim })),
  );
}

/** Uniform section sampling without replacement; no chart payload is loaded. */
export function drawReviewSample(
  candidates: readonly ReviewSampleItem[],
  limit: number,
  random = Math.random,
): ReviewSampleRef[] {
  const pool = [...candidates];
  const count = Math.min(pool.length, limit);
  const selected: ReviewSampleItem[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }
  return selected.map(sampleRef);
}
