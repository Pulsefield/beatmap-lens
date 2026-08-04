import { describe, expect, it } from "vitest";
import { type AnnotationDraft, hasMeaningfulDraft, MemorySessionStore } from "./session-store";

describe("MemorySessionStore", () => {
  it("implements preferences, persisted handles, and the keyed draft journal", async () => {
    const store = new MemorySessionStore();
    const handle = { kind: "directory", name: "dataset" };
    const draft: AnnotationDraft = {
      annotationEditorDirty: true,
      base: null,
      datasetId: "dataset-a",
      editorText: "unfinished",
      exemplarRoles: [{ kind: "strong", tagId: "stream" }],
      labels: [{ salience: 2, tagId: "stream" }],
      noteRefs: [],
      playheadMs: 1_000,
      range: { endMs: 2_000, startMs: 500 },
      rangeEditor: { end: "broken", start: "01:02." },
      reviewNoteIncludeSelection: false,
      reviewNoteText: "definition still needs review",
      sourceSha256: "a".repeat(64),
      undoState: [{ action: "select" }],
      visualSpeed: 480,
    };

    await store.setDirectoryHandle("dataset", handle);
    await store.setPreferences({
      annotatorId: "expert-a",
      musicEnabled: false,
      visualSpeed: 480,
    });
    await store.putDraft(draft);

    expect(await store.getDirectoryHandle("dataset")).toBe(handle);
    expect(await store.getPreferences()).toEqual({
      annotatorId: "expert-a",
      musicEnabled: false,
      visualSpeed: 480,
    });
    expect(await store.getDraft("dataset-a", "a".repeat(64))).toEqual(draft);
    expect((await store.getDraft("dataset-a", "a".repeat(64)))?.rangeEditor).toEqual({
      end: "broken",
      start: "01:02.",
    });
    expect(await store.getDraft("dataset-b", "a".repeat(64))).toBeUndefined();
  });

  it("lists drafts for one dataset without sharing mutable records", async () => {
    const store = new MemorySessionStore();
    const first = draftFor("dataset-a", "b", { editorText: "first" });
    const second = draftFor("dataset-a", "a", { editorText: "second" });
    await store.putDraft(first);
    await store.putDraft(second);
    await store.putDraft(draftFor("dataset-b", "c", { editorText: "other dataset" }));

    const listed = await store.listDrafts("dataset-a");

    expect(listed.map((draft) => draft.sourceSha256)).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(listed).toEqual([second, first]);
    const firstListed = listed[0];
    if (!firstListed) throw new Error("Expected a listed draft.");
    firstListed.labels = [{ salience: 1, tagId: "mutated" }];
    expect((await store.getDraft("dataset-a", "a".repeat(64)))?.labels).toEqual([]);
  });

  it("normalizes drafts saved before exemplar role metadata", async () => {
    const store = new MemorySessionStore();
    const legacy = legacyDraftFor("dataset-a", "a", { editorText: "old local work" });
    await store.putDraft(legacy as AnnotationDraft);

    expect(await store.getDraft("dataset-a", "a".repeat(64))).toEqual({
      ...legacy,
      exemplarRoles: [],
    });
    expect(await store.listDrafts("dataset-a")).toEqual([{ ...legacy, exemplarRoles: [] }]);
    expect(hasMeaningfulDraft(legacy as AnnotationDraft)).toBe(true);
    expect(hasMeaningfulDraft(legacyDraftFor("dataset-a", "b") as AnnotationDraft)).toBe(false);
  });

  it("distinguishes meaningful editor drafts from recoverable playback state", () => {
    expect(
      hasMeaningfulDraft(
        draftFor("dataset-a", "a", {
          annotationEditorDirty: false,
          playheadMs: 12_000,
          range: { endMs: 2_000, startMs: 1_000 },
          reviewNoteText: "   ",
        }),
      ),
    ).toBe(false);
    expect(hasMeaningfulDraft(draftFor("dataset-a", "b", { annotationEditorDirty: true }))).toBe(
      true,
    );
    expect(
      hasMeaningfulDraft(
        draftFor("dataset-a", "c", {
          annotationEditorDirty: false,
          reviewNoteText: "needs source check",
        }),
      ),
    ).toBe(true);
    expect(
      hasMeaningfulDraft(draftFor("dataset-a", "d", { rangeEditor: { end: "bad", start: "" } })),
    ).toBe(true);
  });
});

function draftFor(
  datasetId: string,
  sourceHashCharacter: string,
  overrides: Partial<AnnotationDraft> = {},
): AnnotationDraft {
  return {
    base: null,
    datasetId,
    editorText: "",
    exemplarRoles: [],
    labels: [],
    noteRefs: [],
    playheadMs: 0,
    range: null,
    sourceSha256: sourceHashCharacter.repeat(64),
    undoState: [],
    visualSpeed: 240,
    ...overrides,
  };
}

function legacyDraftFor(
  datasetId: string,
  sourceHashCharacter: string,
  overrides: Partial<AnnotationDraft> = {},
): Omit<AnnotationDraft, "exemplarRoles"> {
  const { exemplarRoles: _exemplarRoles, ...draft } = draftFor(
    datasetId,
    sourceHashCharacter,
    overrides,
  );
  return draft;
}
