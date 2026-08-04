import { describe, expect, it } from "vitest";
import { hashFoundationV1 } from "./canonical-json";
import type {
  AnnotationDocumentV1,
  FoundationTagV1,
  GoldAnnotationV1,
  PredictionReviewStatusV1,
  SilverPredictionV1,
} from "./contracts";
import {
  addReviewNoteV1,
  completeAnnotationDocumentV1,
  promoteFoundationExemplarV1,
  resolveReviewNoteV1,
  sameTagOverlapWarningsV1,
} from "./quality";
import { fixtureDocument, fixtureFoundation } from "./test-helpers";
import { validateCompatibleFoundationRevisionV1 } from "./validation";

const annotationId = "00000000-0000-4000-8000-000000000003";
const noteId = "00000000-0000-4000-8000-000000000004";
const noteCreatedAt = "2026-08-04T00:01:00.000Z";
const resolvedAt = "2026-08-04T00:02:00.000Z";

describe("annotation quality workflow helpers", () => {
  it("promotes a gold annotation to an immutable compatible Foundation exemplar", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const document = fixtureDocument(foundationRef);

    const next = await promoteFoundationExemplarV1(
      foundation,
      document,
      {
        annotationId,
        kind: "strong",
        tagId: "stream",
      },
      {
        createdAt: "2026-08-04T00:03:00.000Z",
        creatorId: "expert-b",
      },
    );

    expect(next).not.toBe(foundation);
    expect(next.revision).toBe(2);
    expect(next.parentSha256).toBe(foundationRef.sha256);
    expect(validateCompatibleFoundationRevisionV1(foundation, next, foundationRef.sha256)).toEqual(
      [],
    );
    expect(next.tags.find((tag) => tag.id === "stream")?.exemplars).toEqual([
      {
        annotationId,
        kind: "strong",
        sourceSha256: document.source.sha256,
      },
    ]);
    expect(foundation.tags.find((tag) => tag.id === "stream")?.exemplars).toEqual([]);
    await expect(
      promoteFoundationExemplarV1(
        next,
        document,
        { annotationId, kind: "weak", tagId: "stream" },
        { createdAt: "2026-08-04T00:04:00.000Z", creatorId: "expert-b" },
      ),
    ).rejects.toThrow(/already has this exemplar/);
  });

  it("requires exemplar promotion to target an active tag used by the annotation", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const document = fixtureDocument(foundationRef);
    const withCandidate = {
      ...foundation,
      tags: [
        ...foundation.tags,
        {
          aliases: [],
          definition: "",
          displayName: "Candidate",
          exemplars: [],
          id: "candidate",
          inclusionCues: [],
          status: "candidate",
        } satisfies FoundationTagV1,
      ],
    };
    const revision = {
      createdAt: "2026-08-04T00:03:00.000Z",
      creatorId: "expert-b",
    };

    await expect(
      promoteFoundationExemplarV1(
        foundation,
        document,
        {
          annotationId,
          kind: "strong",
          tagId: "missing-label",
        },
        revision,
      ),
    ).rejects.toThrow(/does not define tag missing-label/);
    await expect(
      promoteFoundationExemplarV1(
        withCandidate,
        document,
        {
          annotationId,
          kind: "strong",
          tagId: "candidate",
        },
        revision,
      ),
    ).rejects.toThrow(/candidate, not active/);
  });

  it("uses unlabeled gold as a counterexample and prevents contradictory reuse", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const document = fixtureDocument(foundationRef);
    const withoutJack: AnnotationDocumentV1 = {
      ...document,
      annotations: document.annotations.map((annotation) => ({
        ...annotation,
        labels: annotation.labels.filter((label) => label.tagId !== "jack"),
      })),
    };
    const revision = {
      createdAt: "2026-08-04T00:03:00.000Z",
      creatorId: "expert-b",
    };

    const next = await promoteFoundationExemplarV1(
      foundation,
      withoutJack,
      { annotationId, kind: "counterexample", tagId: "jack" },
      revision,
    );
    expect(next.tags.find((tag) => tag.id === "jack")?.exemplars).toEqual([
      {
        annotationId,
        kind: "counterexample",
        sourceSha256: document.source.sha256,
      },
    ]);
    await expect(
      promoteFoundationExemplarV1(
        foundation,
        document,
        { annotationId, kind: "counterexample", tagId: "jack" },
        revision,
      ),
    ).rejects.toThrow(/is labeled jack/);
    await expect(
      promoteFoundationExemplarV1(
        next,
        withoutJack,
        { annotationId, kind: "counterexample", tagId: "jack" },
        revision,
      ),
    ).rejects.toThrow(/already has this exemplar/);
  });

  it("adds and resolves durable review notes while preserving creation metadata", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const document = fixtureDocument(foundationRef, { reviewState: "complete" });
    const noteRef = document.annotations[0]?.noteRefs[0];
    if (!noteRef) throw new Error("Expected fixture note ref");

    const withNote = addReviewNoteV1(document, {
      createId: () => noteId,
      now: () => noteCreatedAt,
      noteRefs: [noteRef],
      range: { endMs: 2_000, startMs: 1_000 },
      text: "  definition needs an exemplar  ",
    });
    const resolved = resolveReviewNoteV1(withNote, {
      id: noteId,
      now: () => resolvedAt,
      resultingFoundation: foundationRef,
      resultingGoldAnnotationId: annotationId,
    });

    expect(withNote.reviewNotes).toHaveLength(1);
    expect(withNote.reviewState).toBe("in-progress");
    expect(withNote.reviewNotes[0]).toMatchObject({
      createdAt: noteCreatedAt,
      id: noteId,
      state: "open",
      text: "definition needs an exemplar",
    });
    expect(resolved.reviewNotes[0]).toMatchObject({
      createdAt: noteCreatedAt,
      id: noteId,
      resultingFoundation: foundationRef,
      resultingGoldAnnotationId: annotationId,
      state: "resolved",
    });
    expect(resolved.reviewNotes[0]?.noteRefs).toEqual([noteRef]);
    expect(resolved.revision).toBe(document.revision + 2);
    expect(resolved.updatedAt).toBe(resolvedAt);
    expect(document.reviewNotes).toEqual([]);
  });

  it("reports same-tag overlap warnings without blocking valid overlaps", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const document = fixtureDocument(foundationRef);
    const seed = document.annotations[0];
    if (!seed) throw new Error("Expected fixture annotation");
    const overlappingStream: GoldAnnotationV1 = {
      ...seed,
      id: "00000000-0000-4000-8000-000000000005",
      labels: [{ salience: 1, tagId: "stream" }],
      range: { endMs: 2_500, startMs: 1_500 },
    };
    const overlappingDifferentTag: GoldAnnotationV1 = {
      ...seed,
      id: "00000000-0000-4000-8000-000000000006",
      labels: [{ salience: 1, tagId: "jack" }],
      range: { endMs: 2_500, startMs: 1_500 },
    };

    expect(
      sameTagOverlapWarningsV1({
        annotations: [seed, overlappingStream, overlappingDifferentTag],
      }),
    ).toEqual([
      {
        leftAnnotationId: seed.id,
        overlap: { endMs: 2_000, startMs: 1_500 },
        rightAnnotationId: overlappingStream.id,
        tagId: "stream",
      },
      {
        leftAnnotationId: seed.id,
        overlap: { endMs: 2_000, startMs: 1_500 },
        rightAnnotationId: overlappingDifferentTag.id,
        tagId: "jack",
      },
    ]);
  });

  it("blocks chart completion until drafts, open notes, and pending predictions are cleared", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const document = fixtureDocument(foundationRef);
    const blocked: AnnotationDocumentV1 = {
      ...addReviewNoteV1(document, {
        createId: () => noteId,
        now: () => noteCreatedAt,
        text: "Needs review",
      }),
      predictions: [prediction(document)],
    };

    expect(completeAnnotationDocumentV1(blocked, { hasUncommittedDraft: true })).toEqual({
      blockers: ["uncommitted-draft", "open-review-note", "pending-prediction"],
      ok: false,
    });

    const cleared = {
      ...resolveReviewNoteV1(blocked, {
        id: noteId,
        now: () => resolvedAt,
      }),
      predictions: [
        {
          ...(blocked.predictions[0] as SilverPredictionV1),
          reviewStatus: "reviewed" as PredictionReviewStatusV1,
        },
      ],
    };
    const complete = completeAnnotationDocumentV1(cleared, {
      now: () => "2026-08-04T00:04:00.000Z",
    });

    expect(complete).toMatchObject({
      ok: true,
      document: {
        reviewState: "complete",
        revision: cleared.revision + 1,
        updatedAt: "2026-08-04T00:04:00.000Z",
      },
    });
  });
});

function prediction(document: AnnotationDocumentV1): SilverPredictionV1 {
  const annotation = document.annotations[0];
  if (!annotation) throw new Error("Expected fixture annotation");
  return {
    confidence: 0.9,
    createdAt: "2026-08-04T00:00:00.000Z",
    foundation: annotation.foundation,
    id: "00000000-0000-4000-8000-000000000007",
    labels: annotation.labels,
    modelVersion: "fixture-model",
    noteRefs: annotation.noteRefs,
    producerId: "fixture-agent",
    range: annotation.range,
    reviewStatus: "pending",
    skillVersion: "fixture-skill",
  };
}
