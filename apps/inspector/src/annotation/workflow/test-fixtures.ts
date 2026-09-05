import { inspectOsuSourceV1 } from "../source-identity";
import { createStableNoteRefsV1 } from "../stable-note-ref";
import type { ClaimV2, FoundationV2 } from "./contracts";
import { FOUNDATION_CONTRACT_V2 } from "./contracts";
import {
  approveFoundationV2,
  createReviewDocumentV2,
  createTaskPacketV2,
  registerTaskV2,
  sealHandoffV2,
} from "./domain";

export const NOW = "2026-09-05T00:00:00.000Z";

export async function workflowFixture() {
  const sourceBytes = new TextEncoder().encode(`osu file format v14

[General]
Mode: 3

[Metadata]
Title: Workflow fixture
Artist: Artist
Creator: Mapper
Version: Mixed
BeatmapID: 123
BeatmapSetID: 456

[Difficulty]
CircleSize: 4

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
64,192,200,128,0,1300:0:0:0:0:
192,192,800,1,0,0:0:0:0:
320,192,1000,1,0,0:0:0:0:
448,192,1200,1,0,0:0:0:0:
192,192,1500,1,0,0:0:0:0:
320,192,1800,1,0,0:0:0:0:
`);
  const inspected = await inspectOsuSourceV1(sourceBytes);
  const refs = createStableNoteRefsV1(inspected.chart);
  const [entryHold, previousTap, firstTap, , laterTap] = refs;
  if (!entryHold || !previousTap || !firstTap || !laterTap)
    throw new Error("Fixture notes are missing.");
  const claim: ClaimV2 = {
    id: "tech-claim",
    sectionId: "mixed-section",
    tagId: "tech",
    scope: { startMs: 1000, endMs: 1800 },
    reviewContext: { startMs: 0, endMs: 1801 },
    assessment: { presence: "present", salience: "prominent" },
    evidence: {
      noteRefs: [entryHold, firstTap, laterTap],
      contextNoteRefs: [previousTap],
      rationale:
        "An arrangement-level judgment with a carried-in hold and discontiguous witnesses.",
    },
    boundaryUncertainty: {
      start: { startMs: 900, endMs: 1100 },
      end: { startMs: 1700, endMs: 1801 },
    },
    transition: {
      range: { startMs: 1000, endMs: 1600 },
      description: "The held organization gives way to tap motion.",
      evidence: {
        noteRefs: [entryHold, laterTap],
        contextNoteRefs: [],
        rationale: "Release of the entering hold followed by the later tap.",
      },
    },
    exemplarRole: "typical-positive",
  };
  const foundation: FoundationV2 = {
    contract: FOUNDATION_CONTRACT_V2,
    version: 2,
    foundationId: "test-campaign",
    revision: 1,
    createdAt: NOW,
    policies: {
      coordinates: "source-ms",
      rangeConvention: "half-open",
      datasetSemantics: "partially-exhaustive",
      collectionPolicy: "positive-first",
      saliencePolicy: "independent-per-tag-multiple-prominent",
      missingAssessment: "unreviewed-not-negative",
    },
    tags: ["tech", "streams", "jumpstream", "speedjack", "longjack"].map((id) => ({
      id,
      displayName: id,
      definition: `Fixture definition of ${id}.`,
      inclusionCues: ["Inspect the complete arrangement."],
      exclusionCues: [],
      communityAlignment: {
        catalogueUrl: "https://osu.ppy.sh/wiki/en/Beatmap/Beatmap_tags",
        externalTagId: `skillset/${id}`,
        relation: "related",
        scope: "Fixture local definition; no equivalence inferred.",
      },
    })),
    calibrationExamples: [
      {
        id: "initial-calibration",
        source: inspected.source,
        sourceBytes: Array.from(sourceBytes),
        claim,
        explanation: "A source-backed fixture for explicit human approval.",
      },
    ],
    approval: { status: "proposed" },
  };
  const proposed = await createReviewDocumentV2(inspected.source, foundation, {
    id: "review-1",
    now: () => NOW,
  });
  const document = await approveFoundationV2(proposed, "expert", sourceBytes, { now: () => NOW });
  const task = await createTaskPacketV2(document, sourceBytes, {
    taskId: "task-1",
    now: () => NOW,
  });
  const registered = await registerTaskV2(document, task, sourceBytes, { now: () => NOW });
  const handoff = await sealHandoffV2(task, {
    handoffId: "handoff-1",
    createdAt: NOW,
    agent: { producerId: "external-labeler", role: "labeler" },
    proposals: [
      claim,
      { ...claim, id: "streams-claim", tagId: "streams" },
      {
        ...claim,
        id: "speedjack-claim",
        tagId: "speedjack",
        assessment: { presence: "unresolved" },
      },
    ],
    audit: [
      {
        id: "audit-1",
        claimIds: [claim.id],
        finding: "The entering hold remains present at the scope boundary.",
      },
    ],
    questions: [
      {
        id: "question-1",
        claimIds: ["speedjack-claim"],
        text: "Does the speedjack definition apply here?",
      },
    ],
  });
  return {
    sourceBytes,
    inspected,
    refs,
    claim,
    foundation,
    proposed,
    document,
    task,
    registered,
    handoff,
  };
}
