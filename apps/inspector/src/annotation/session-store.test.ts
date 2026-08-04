import { describe, expect, it } from "vitest";
import { type AnnotationDraft, MemorySessionStore } from "./session-store";

describe("MemorySessionStore", () => {
  it("implements preferences, persisted handles, and the keyed draft journal", async () => {
    const store = new MemorySessionStore();
    const handle = { kind: "directory", name: "dataset" };
    const draft: AnnotationDraft = {
      base: null,
      datasetId: "dataset-a",
      editorText: "unfinished",
      labels: [{ salience: 2, tagId: "stream" }],
      noteRefs: [],
      playheadMs: 1_000,
      range: { endMs: 2_000, startMs: 500 },
      rangeEditor: { end: "broken", start: "01:02." },
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
});
