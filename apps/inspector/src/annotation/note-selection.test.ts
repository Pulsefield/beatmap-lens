import type { ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import {
  changeNoteSelectionRange,
  createNoteSelection,
  toggleSelectedNote,
} from "./note-selection";

describe("note selection", () => {
  const crossing = note("crossing", 50, 250, "long");
  const first = note("first", 100);
  const second = note("second", 200);
  const distant = note("distant", 300);
  const notes = [crossing, first, second, distant];

  it("starts with all range candidates and toggles manual exclusions", () => {
    const selection = createNoteSelection(notes, { startMs: 100, endMs: 200 });
    const excluded = toggleSelectedNote(notes, selection, crossing);
    const includedAgain = toggleSelectedNote(notes, excluded, crossing);

    expect(selection.selectedNotes.map(({ id }) => id)).toEqual(["crossing", "first"]);
    expect(excluded.manualExclusions.has("crossing")).toBe(true);
    expect(excluded.selectedNotes.map(({ id }) => id)).toEqual(["first"]);
    expect(includedAgain.selectedNotes.map(({ id }) => id)).toEqual(["crossing", "first"]);
  });

  it("preserves exclusions only while they remain applicable after a range change", () => {
    const selection = createNoteSelection(notes, { startMs: 100, endMs: 200 });
    const withoutFirst = toggleSelectedNote(notes, selection, first);
    const moved = changeNoteSelectionRange(notes, withoutFirst, { startMs: 200, endMs: 300 });
    const movedBack = changeNoteSelectionRange(notes, moved, { startMs: 100, endMs: 200 });

    expect(moved.manualExclusions.size).toBe(0);
    expect(moved.selectedNotes.map(({ id }) => id)).toEqual(["crossing", "second"]);
    expect(movedBack.selectedNotes.map(({ id }) => id)).toEqual(["crossing", "first"]);
  });

  it("expands the range before selecting a non-intersecting note", () => {
    const selection = createNoteSelection(notes, { startMs: 100, endMs: 200 });
    const expanded = toggleSelectedNote(notes, selection, distant);

    expect(expanded.range).toEqual({ startMs: 100, endMs: 301 });
    expect(expanded.selectedNotes.map(({ id }) => id)).toEqual([
      "crossing",
      "first",
      "second",
      "distant",
    ]);
  });
});

function note(
  id: string,
  startTime: number,
  endTime = startTime,
  kind: ManiaNote["kind"] = "normal",
): ManiaNote {
  return {
    id,
    kind,
    sourceKind: kind === "long" ? "hold" : "normal",
    column: 0,
    startTime,
    endTime,
    sourceLine: 1,
    x: 64,
    hitSound: 0,
  };
}
