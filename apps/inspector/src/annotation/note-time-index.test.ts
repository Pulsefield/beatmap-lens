import type { ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import { ManiaNoteTimeIndex } from "./note-time-index";

describe("ManiaNoteTimeIndex", () => {
  it("uses half-open onset membership and includes long notes crossing the boundary", () => {
    const crossing = note("crossing", 50, 150, "long");
    const atStart = note("at-start", 100);
    const atEnd = note("at-end", 200);
    const index = new ManiaNoteTimeIndex([atEnd, crossing, atStart]);

    expect(index.notesInRange({ startMs: 100, endMs: 200 }).map(({ id }) => id)).toEqual([
      "crossing",
      "at-start",
    ]);
  });

  it("indexes note onsets and long-note tails as unique timeline snap points", () => {
    const index = new ManiaNoteTimeIndex([
      note("normal", 100),
      note("long", 200, 300, "long"),
      note("tail-onset", 300),
    ]);

    expect(index.snapPoints).toEqual([100, 200, 300]);
    expect(index.nearestSnapPoint(250)).toBe(200);
    expect(index.nearestSnapPoint(280)).toBe(300);
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
