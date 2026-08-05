import { describe, expect, it } from "vitest";
import { sha256Hex } from "./canonical-json";
import type { CatalogSource } from "./catalog";
import { ANNOTATION_CONTRACT, FOUNDATION_CONTRACT, type JudgmentFoundationV1 } from "./contracts";
import { createDatasetDirectory } from "./dataset-directory";
import { FOUNDATION_POLICIES_V1 } from "./foundation";
import { type AnnotationDraft, MemorySessionStore } from "./session-store";
import { loadTaskQueue } from "./task-queue";
import { FakeDirectoryHandle } from "./test-helpers";

const source = `osu file format v14

[General]
Mode:3

[Metadata]
Title:Queue fixture
Artist:Beatmap Lens
Creator:Expert
Version:4K

[Difficulty]
CircleSize:4

[HitObjects]
64,192,1000,1,0,0:0:0:0:
`;

describe("catalog task queue", () => {
  it("surfaces a restored draft conflict before the next save attempt", async () => {
    const datasetRoot = new FakeDirectoryHandle("dataset");
    const directory = await createDatasetDirectory(datasetRoot, {
      catalogSources: [{ csvSha256: "d".repeat(64), url: "https://example.test/catalog.csv" }],
      datasetId: "00000000-0000-4000-8000-000000000010",
      foundation: queueFoundation(),
      name: "Queue fixture",
      now: () => "2026-08-04T00:00:00.000Z",
    });
    const corpus = new FakeDirectoryHandle("corpus");
    (await corpus.getFileHandle("fixture.osu", { create: true })).setText(source);
    const sourceSha256 = await sha256Hex(source);
    const sessions = new CountingSessionStore();
    await sessions.putDraft(
      legacyDraft({
        base: { revision: 4, sha256: "e".repeat(64) },
        datasetId: directory.manifest.datasetId,
        editorText: "local work",
        labels: [],
        noteRefs: [],
        playheadMs: 0,
        range: null,
        sourceSha256,
        undoState: [],
        visualSpeed: 240,
      }),
    );

    const queue = await loadTaskQueue(catalog(), corpus, directory, sessions);

    expect(sessions.listDraftsCalls).toBe(1);
    expect(sessions.getDraftCalls).toBe(0);
    expect(queue).toMatchObject([
      {
        displayName: "fixture.osu",
        source: { sha256: sourceSha256 },
        status: "save-conflict",
      },
    ]);
  });

  it("preserves future annotation versions as read-only queue tasks", async () => {
    const datasetRoot = new FakeDirectoryHandle("dataset");
    const directory = await createDatasetDirectory(datasetRoot, {
      catalogSources: [{ csvSha256: "d".repeat(64), url: "https://example.test/catalog.csv" }],
      datasetId: "00000000-0000-4000-8000-000000000010",
      foundation: queueFoundation(),
      name: "Queue fixture",
      now: () => "2026-08-04T00:00:00.000Z",
    });
    const corpus = new FakeDirectoryHandle("corpus");
    (await corpus.getFileHandle("fixture.osu", { create: true })).setText(source);
    const sourceSha256 = await sha256Hex(source);
    const annotations = await datasetRoot.getDirectoryHandle("annotations");
    (
      await annotations.getFileHandle(`${sourceSha256}.section-annotations.v2.json`, {
        create: true,
      })
    ).setText(
      JSON.stringify({
        contract: ANNOTATION_CONTRACT,
        revision: 7,
        source: { byteLength: new TextEncoder().encode(source).byteLength, sha256: sourceSha256 },
        version: 2,
      }),
    );
    const sessions = new MemorySessionStore();
    await sessions.putDraft({
      base: { revision: 1, sha256: "e".repeat(64) },
      datasetId: directory.manifest.datasetId,
      editorText: "old local work",
      exemplarRoles: [],
      labels: [],
      noteRefs: [],
      playheadMs: 0,
      range: null,
      sourceSha256,
      undoState: [],
      visualSpeed: 240,
    });

    const queue = await loadTaskQueue(catalog(), corpus, directory, sessions);

    expect(queue).toMatchObject([
      {
        future: { revision: 7, version: 2 },
        source: { sha256: sourceSha256 },
        status: "readonly-future",
      },
    ]);
  });
});

function catalog(): CatalogSource {
  return {
    categories: ["stream"],
    sha256: "d".repeat(64),
    source: "https://example.test/catalog.csv",
    tasks: [{ categories: ["stream"], pathSegments: ["fixture.osu"] }],
  };
}

function legacyDraft(draft: Omit<AnnotationDraft, "exemplarRoles">): AnnotationDraft {
  return draft as AnnotationDraft;
}

function queueFoundation(): JudgmentFoundationV1 {
  return {
    contract: FOUNDATION_CONTRACT,
    createdAt: "2026-08-04T00:00:00.000Z",
    creatorId: "expert-a",
    foundationId: "00000000-0000-4000-8000-000000000001",
    language: "zh-CN",
    policies: FOUNDATION_POLICIES_V1,
    revision: 1,
    tags: [
      {
        aliases: [],
        definition: "A stream section.",
        displayName: "Stream",
        id: "stream",
        inclusionCues: ["Alternating single-note motion."],
        status: "active",
      },
      {
        aliases: [],
        definition: "A jack section.",
        displayName: "Jack",
        id: "jack",
        inclusionCues: ["Repeated notes in one column."],
        status: "active",
      },
    ],
    version: 1,
  };
}

class CountingSessionStore extends MemorySessionStore {
  getDraftCalls = 0;
  listDraftsCalls = 0;

  override async getDraft(
    datasetId: string,
    sourceSha256: string,
  ): Promise<Awaited<ReturnType<MemorySessionStore["getDraft"]>>> {
    this.getDraftCalls += 1;
    return super.getDraft(datasetId, sourceSha256);
  }

  override async listDrafts(
    datasetId: string,
  ): Promise<Awaited<ReturnType<MemorySessionStore["listDrafts"]>>> {
    this.listDraftsCalls += 1;
    return super.listDrafts(datasetId);
  }
}
