import { describe, expect, it } from "vitest";
import type { InboxClaimV2, InboxSourceV2 } from "./remote-workspace";
import { sampleCandidates } from "./review-sampling";
import { workflowFixture } from "./test-fixtures";

describe("review sampling", () => {
  it("deduplicates equivalent historical 1x claims while retaining other judgment speeds", async () => {
    const f = await workflowFixture();
    const claim: InboxClaimV2 = {
      handoffId: f.handoff.handoffId,
      claimId: f.claim.id,
      tagId: f.claim.tagId,
      scope: f.claim.scope,
      assessment: f.claim.assessment,
      status: "agent-reviewed",
      rationale: "Source-backed judgment.",
    };
    const source: InboxSourceV2 = {
      source: f.inspected.source,
      version: f.task.base,
      counts: {},
      expertQueue: [],
      requests: [],
      reviews: [
        claim,
        { ...claim, claimId: "explicit-1x", playbackRate: 1 },
        { ...claim, claimId: "slower", playbackRate: 0.75 },
        { ...claim, claimId: "faster", playbackRate: 1.25 },
      ],
    };
    expect(sampleCandidates([source], "", "all").map(({ claim }) => claim.claimId)).toEqual([
      f.claim.id,
      "slower",
      "faster",
    ]);
  });
});
