import type { ManiaChart } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import {
  hashFoundationV1,
  serializeAnnotationDocumentV1,
  serializeFoundationV1,
} from "./canonical-json";
import type {
  AnnotationDocumentV1,
  FoundationTagV1,
  GoldAnnotationV1,
  JudgmentFoundationV1,
} from "./contracts";
import { activateFoundationTagV1, bootstrapFoundationV1, foundationRefV1 } from "./foundation";
import { assertSourceBytesMatch, inspectOsuSourceV1 } from "./source-identity";
import { createStableNoteRefV1, resolveStableNoteRefsV1 } from "./stable-note-ref";
import {
  assertAnnotationDocumentV1,
  validateAnnotationDocumentV1,
  validateAnnotationWorkflowV1,
  validateCompatibleFoundationRevisionV1,
} from "./validation";

const encoder = new TextEncoder();
const now = "2026-08-04T00:00:00.000Z";
const foundationId = "10000000-0000-4000-8000-000000000001";
const documentId = "10000000-0000-4000-8000-000000000002";
const annotationId = "10000000-0000-4000-8000-000000000003";

describe("annotation v1 contracts", () => {
  it("round-trips deterministic gold JSON with independent multi-label salience", async () => {
    const fixture = await createFixture();
    const document = createDocument(fixture, [
      { tagId: "streams", salience: 2 },
      { tagId: "jacks", salience: 1 },
    ]);
    const annotation = document.annotations[0];
    if (!annotation) throw new Error("Expected the fixture gold annotation");
    const reversed: AnnotationDocumentV1 = {
      ...document,
      seedContext: { ...document.seedContext, suggestedTags: ["streams", "jacks"] },
      annotations: [
        {
          ...annotation,
          labels: [...annotation.labels].reverse(),
        },
      ],
    };

    const json = serializeAnnotationDocumentV1(document);
    expect(serializeAnnotationDocumentV1(reversed)).toBe(json);
    expect(json.endsWith("\n")).toBe(true);
    expect(json).not.toContain("\r");

    const parsed: unknown = JSON.parse(json);
    assertAnnotationDocumentV1(parsed);
    expect(serializeAnnotationDocumentV1(parsed)).toBe(json);
    expect(parsed.annotations[0]?.labels).toEqual([
      { salience: 1, tagId: "jacks" },
      { salience: 2, tagId: "streams" },
    ]);

    const workflow = await validateAnnotationWorkflowV1(parsed, {
      sourceBytes: fixture.bytes,
      chart: fixture.chart,
      foundations: [{ foundation: fixture.foundation }],
    });
    expect(workflow).toEqual({ ok: true, value: parsed });
  });

  it("accepts active gold tags and rejects candidate or retired tags", async () => {
    const fixture = await createFixture();

    for (const [tagId, accepted] of [
      ["streams", true],
      ["candidate-pattern", false],
      ["retired-pattern", false],
    ] as const) {
      const document = createDocument(fixture, [{ tagId, salience: 2 }]);
      const validation = await validateAnnotationWorkflowV1(document, {
        sourceBytes: fixture.bytes,
        chart: fixture.chart,
        foundations: [{ foundation: fixture.foundation }],
      });
      expect(validation.ok, tagId).toBe(accepted);
      if (!validation.ok && !accepted) {
        expect(validation.issues.some((issue) => issue.message.includes(tagId))).toBe(true);
      }
    }
  });

  it("pins exact immutable Foundation bytes and validates compatible activation", async () => {
    const candidate = bootstrapFoundationV1({
      foundationId,
      creatorId: "expert-a",
      createdAt: now,
      catalogTags: ["Streams"],
    });
    const parentSha256 = await hashFoundationV1(candidate);
    const active = await activateFoundationTagV1(
      candidate,
      {
        tagId: "streams",
        definition: "连续交替的密集音符序列",
        inclusionCues: ["持续的交替击键"],
      },
      {
        creatorId: "expert-a",
        createdAt: "2026-08-04T00:01:00.000Z",
      },
    );

    expect(active.parentSha256).toBe(parentSha256);
    expect(active.revision).toBe(candidate.revision + 1);
    expect(active.tags[0]?.status).toBe("active");
    expect(validateCompatibleFoundationRevisionV1(candidate, active, parentSha256)).toEqual([]);
    expect(await foundationRefV1(active)).toEqual({
      foundationId,
      revision: 2,
      sha256: await hashFoundationV1(active),
    });
    expect(serializeFoundationV1({ ...active, tags: [...active.tags].reverse() })).toBe(
      serializeFoundationV1(active),
    );
  });

  it("preserves curated candidate cues and clarification during activation", async () => {
    const candidate = bootstrapFoundationV1({
      foundationId,
      creatorId: "expert-a",
      createdAt: now,
      catalogTags: ["Streams"],
    });
    const candidateTag = candidate.tags[0];
    if (!candidateTag) throw new Error("Expected the candidate tag");
    const curated: JudgmentFoundationV1 = {
      ...candidate,
      tags: [
        {
          ...candidateTag,
          inclusionCues: ["已有线索"],
          exclusionCues: ["排除线索"],
          aliases: ["flow"],
          salienceClarification: "持续出现时为强",
        },
      ],
    };
    const active = await activateFoundationTagV1(
      curated,
      {
        tagId: "streams",
        definition: "连续音流",
        inclusionCues: ["新增线索"],
        exclusionCues: ["新增排除"],
      },
      { creatorId: "expert-a", createdAt: now },
    );

    expect(active.tags[0]).toMatchObject({
      aliases: ["flow"],
      exclusionCues: ["排除线索", "新增排除"],
      inclusionCues: ["已有线索", "新增线索"],
      salienceClarification: "持续出现时为强",
      status: "active",
    });
  });

  it("activates a new custom tag through the same compatible Foundation revision", async () => {
    const foundation = bootstrapFoundationV1({
      foundationId,
      creatorId: "expert-a",
      createdAt: now,
      catalogTags: [],
    });
    const parentSha256 = await hashFoundationV1(foundation);
    const active = await activateFoundationTagV1(
      foundation,
      {
        aliases: ["anchor"],
        definition: "A custom anchor pattern.",
        displayName: "Anchor pattern",
        exclusionCues: ["A single isolated note."],
        inclusionCues: ["Repeated anchored movement."],
        salienceClarification: "Strong when it structures the whole section.",
        tagId: "anchor-pattern",
      },
      { creatorId: "expert-a", createdAt: "2026-08-04T00:02:00.000Z" },
    );

    expect(active.tags).toEqual([
      expect.objectContaining({
        aliases: ["anchor"],
        displayName: "Anchor pattern",
        id: "anchor-pattern",
        status: "active",
      }),
    ]);
    expect(validateCompatibleFoundationRevisionV1(foundation, active, parentSha256)).toEqual([]);
  });

  it("rejects a gold annotation pinned to the wrong Foundation digest", async () => {
    const fixture = await createFixture();
    const document = createDocument(fixture, [{ tagId: "streams", salience: 2 }]);
    const annotation = document.annotations[0];
    if (!annotation) throw new Error("Expected the fixture gold annotation");
    const wrongPin: AnnotationDocumentV1 = {
      ...document,
      annotations: [
        {
          ...annotation,
          foundation: { ...annotation.foundation, sha256: "f".repeat(64) },
        },
      ],
    };

    const validation = await validateAnnotationWorkflowV1(wrongPin, {
      sourceBytes: fixture.bytes,
      chart: fixture.chart,
      foundations: [{ foundation: fixture.foundation }],
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues).toContainEqual({
        path: "$.annotations[0].foundation",
        message: "The pinned Foundation snapshot or digest is unavailable",
      });
    }
  });

  it("blocks duplicate range, note, and tag sets even when salience differs", async () => {
    const fixture = await createFixture();
    const document = createDocument(fixture, [{ tagId: "streams", salience: 2 }]);
    const annotation = document.annotations[0];
    if (!annotation) throw new Error("Expected the fixture gold annotation");
    const duplicate: AnnotationDocumentV1 = {
      ...document,
      annotations: [
        annotation,
        {
          ...annotation,
          id: "10000000-0000-4000-8000-000000000004",
          labels: [{ tagId: "streams", salience: 1 }],
        },
      ],
    };

    const validation = await validateAnnotationWorkflowV1(duplicate, {
      sourceBytes: fixture.bytes,
      chart: fixture.chart,
      foundations: [{ foundation: fixture.foundation }],
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(
        validation.issues.some((issue) => issue.message === "Exact duplicate gold annotation"),
      ).toBe(true);
    }
  });

  it("requires finite prediction confidence separately from salience", async () => {
    const fixture = await createFixture();
    const document = createDocument(fixture, [{ tagId: "streams", salience: 2 }]);
    const annotation = document.annotations[0];
    if (!annotation) throw new Error("Expected the fixture gold annotation");

    const validation = validateAnnotationDocumentV1({
      ...document,
      predictions: [
        {
          id: "10000000-0000-4000-8000-000000000005",
          range: annotation.range,
          noteRefs: annotation.noteRefs,
          labels: annotation.labels,
          foundation: annotation.foundation,
          producerId: "agent-a",
          skillVersion: "1",
          modelVersion: "1",
          confidence: Number.NaN,
          reviewStatus: "pending",
          createdAt: now,
        },
      ],
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.some((issue) => issue.path.endsWith(".confidence"))).toBe(true);
    }
  });

  it("rejects raw source, audio, and local-directory fields instead of serializing them", async () => {
    const fixture = await createFixture();
    const document = createDocument(fixture, [{ tagId: "streams", salience: 2 }]);
    const leaked: unknown = {
      ...document,
      localDirectory: "/Users/expert/private/osu",
      source: {
        ...document.source,
        sourceText: osuSource,
        audioBytes: [1, 2, 3],
      },
    };

    const validation = validateAnnotationDocumentV1(leaked);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["$.localDirectory", "$.source.sourceText", "$.source.audioBytes"]),
      );
    }
    expect(() => assertAnnotationDocumentV1(leaked)).toThrow(/Unexpected contract field/);
  });

  it("fails loudly when exact source bytes change", async () => {
    const fixture = await createFixture();
    const withCrLf = encoder.encode(osuSource.replaceAll("\n", "\r\n"));

    await expect(assertSourceBytesMatch(fixture.source, withCrLf)).rejects.toThrow(
      /Source (byte length|SHA-256) mismatch/,
    );

    const validation = await validateAnnotationWorkflowV1(
      createDocument(fixture, [{ tagId: "streams", salience: 2 }]),
      {
        sourceBytes: withCrLf,
        chart: fixture.chart,
        foundations: [{ foundation: fixture.foundation }],
      },
    );
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.issues[0]?.message).toMatch(/Source .* mismatch/);
  });

  it("rejects a source record whose derived metadata does not match its bytes", async () => {
    const fixture = await createFixture();
    const document = createDocument(fixture, [{ tagId: "streams", salience: 2 }]);
    const mismatched: AnnotationDocumentV1 = {
      ...document,
      source: { ...document.source, title: "Retargeted title" },
    };

    const validation = await validateAnnotationWorkflowV1(mismatched, {
      sourceBytes: fixture.bytes,
      chart: fixture.chart,
      foundations: [{ foundation: fixture.foundation }],
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.some((issue) => issue.message.includes("mismatch at title"))).toBe(
        true,
      );
    }
  });

  it("resolves stable note references independently of runtime ordinals", async () => {
    const fixture = await createFixture();
    const changedChart: ManiaChart = {
      ...fixture.chart,
      notes: fixture.chart.notes.map((note, index) => ({
        ...note,
        id: `runtime-reordered-${fixture.chart.notes.length - index}`,
      })),
    };

    const resolved = await resolveStableNoteRefsV1(
      fixture.bytes,
      changedChart,
      [fixture.noteRef],
      fixture.source.sha256,
    );
    expect(resolved[0]?.id).toBe("runtime-reordered-3");
    expect(resolved[0]?.sourceLine).toBe(fixture.noteRef.sourceLine);
  });

  it("hashes exact HitObject line bytes without the newline and rejects a changed object digest", async () => {
    const fixture = await createFixture();
    const crLfBytes = encoder.encode(osuSource.replaceAll("\n", "\r\n"));
    const crLf = await inspectOsuSourceV1(crLfBytes);
    const crLfFirstNote = crLf.chart.notes[0];
    if (!crLfFirstNote) throw new Error("Expected the CRLF fixture note");
    const crLfRef = await createStableNoteRefV1(crLfBytes, crLfFirstNote);

    expect(crLfRef.objectSha256).toBe(fixture.noteRef.objectSha256);
    expect(crLf.source.sha256).not.toBe(fixture.source.sha256);
    await expect(
      resolveStableNoteRefsV1(
        fixture.bytes,
        fixture.chart,
        [{ ...fixture.noteRef, objectSha256: "f".repeat(64) }],
        fixture.source.sha256,
      ),
    ).rejects.toThrow(/HitObject line .* SHA-256 mismatch/);
  });
});

async function createFixture() {
  const bytes = encoder.encode(osuSource);
  const inspected = await inspectOsuSourceV1(bytes);
  const firstNote = inspected.chart.notes[0];
  if (!firstNote) throw new Error("Expected the fixture note");
  const noteRef = await createStableNoteRefV1(bytes, firstNote);

  let foundation = bootstrapFoundationV1({
    foundationId,
    creatorId: "expert-a",
    createdAt: now,
    catalogTags: ["Streams", "Jacks", "Candidate Pattern", "Retired Pattern"],
  });
  foundation = await activateFoundationTagV1(
    foundation,
    { tagId: "streams", definition: "连续音流", inclusionCues: ["连续交替"] },
    { creatorId: "expert-a", createdAt: "2026-08-04T00:01:00.000Z" },
  );
  foundation = await activateFoundationTagV1(
    foundation,
    { tagId: "jacks", definition: "同列连续击打", inclusionCues: ["同列重复"] },
    { creatorId: "expert-a", createdAt: "2026-08-04T00:02:00.000Z" },
  );
  foundation = {
    ...foundation,
    tags: foundation.tags.map(
      (tag): FoundationTagV1 =>
        tag.id === "retired-pattern"
          ? {
              ...tag,
              status: "retired",
              definition: "已退役的旧语义",
              inclusionCues: ["旧线索"],
            }
          : tag,
    ),
  };

  return {
    bytes,
    chart: inspected.chart,
    source: inspected.source,
    noteRef,
    foundation,
    foundationRef: await foundationRefV1(foundation),
  };
}

function createDocument(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  labels: GoldAnnotationV1["labels"],
): AnnotationDocumentV1 {
  return {
    contract: "beatmap-lens-section-annotations",
    version: 1,
    documentId,
    source: fixture.source,
    seedContext: {
      catalogSha256: "a".repeat(64),
      suggestedTags: ["jacks", "streams"],
    },
    reviewState: "in-progress",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    annotations: [
      {
        id: annotationId,
        range: { startMs: 500, endMs: 501 },
        noteRefs: [fixture.noteRef],
        labels,
        foundation: fixture.foundationRef,
        annotatorId: "expert-a",
        createdAt: now,
        updatedAt: now,
        derivedFromPredictionIds: [],
      },
    ],
    predictions: [],
    reviewNotes: [],
  };
}

const osuSource = `osu file format v14

[General]
Mode: 3

[Metadata]
Title:Contract Fixture
Artist:Beatmap Lens
Creator:Codex
Version:Test

[Difficulty]
CircleSize:4

[HitObjects]
64,192,500,1,0,0:0:0:0:
192,192,750,128,0,1250:0:0:0:
320,192,1500,1,0,0:0:0:0:
`;
