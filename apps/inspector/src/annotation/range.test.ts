import type { ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import {
  expandRangeToIncludeNote,
  intersectRanges,
  noteIntersectsRange,
  rangeCandidates,
  rangesIntersect,
} from "./range";

describe("half-open annotation ranges", () => {
  it("places a normal note in only the section containing its onset", () => {
    const normal = note({ startTime: 100, endTime: 100 });

    expect(noteIntersectsRange(normal, { startMs: 0, endMs: 100 })).toBe(false);
    expect(noteIntersectsRange(normal, { startMs: 100, endMs: 200 })).toBe(true);
    expect(rangeCandidates([normal], { startMs: 0, endMs: 100 })).toEqual([]);
    expect(rangeCandidates([normal], { startMs: 100, endMs: 200 })).toEqual([normal]);
  });

  it("includes a long note in every section with interval overlap", () => {
    const long = note({ kind: "long", sourceKind: "hold", startTime: 50, endTime: 150 });

    expect(noteIntersectsRange(long, { startMs: 0, endMs: 50 })).toBe(false);
    expect(noteIntersectsRange(long, { startMs: 50, endMs: 100 })).toBe(true);
    expect(noteIntersectsRange(long, { startMs: 100, endMs: 150 })).toBe(true);
    expect(noteIntersectsRange(long, { startMs: 150, endMs: 200 })).toBe(false);
  });

  it("keeps touching ranges disjoint and returns their half-open intersection", () => {
    expect(rangesIntersect({ startMs: 0, endMs: 100 }, { startMs: 100, endMs: 200 })).toBe(false);
    expect(intersectRanges({ startMs: 0, endMs: 150 }, { startMs: 100, endMs: 200 })).toEqual({
      startMs: 100,
      endMs: 150,
    });
  });

  it("expands a range when an explicitly selected note is outside it", () => {
    const normal = note({ startTime: 100, endTime: 100 });
    const long = note({
      id: "long",
      kind: "long",
      sourceKind: "hold",
      startTime: 200,
      endTime: 350,
    });

    expect(expandRangeToIncludeNote({ startMs: 0, endMs: 100 }, normal)).toEqual({
      startMs: 0,
      endMs: 101,
    });
    expect(expandRangeToIncludeNote({ startMs: 0, endMs: 100 }, long)).toEqual({
      startMs: 0,
      endMs: 350,
    });
    expect(expandRangeToIncludeNote({ startMs: 250, endMs: 300 }, long)).toEqual({
      startMs: 250,
      endMs: 300,
    });
  });
});

function note(overrides: Partial<ManiaNote>): ManiaNote {
  return {
    id: "normal",
    kind: "normal",
    sourceKind: "normal",
    column: 0,
    startTime: 0,
    endTime: 0,
    sourceLine: 1,
    x: 64,
    hitSound: 0,
    ...overrides,
  };
}
