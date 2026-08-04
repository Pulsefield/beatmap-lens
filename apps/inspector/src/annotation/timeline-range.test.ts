import type { ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import { ManiaNoteTimeIndex } from "./note-time-index";
import {
  createTimelineRange,
  moveTimelineRange,
  parseManualRangeDraft,
  parseTimeInput,
  resizeTimelineRange,
} from "./timeline-range";

describe("timeline range operations", () => {
  const index = new ManiaNoteTimeIndex([
    note("first", 100),
    note("hold", 300, 800, "long"),
    note("last", 1_000),
  ]);
  const options = { chartEndMs: 1_200 };

  it("snaps creation and resize to note onsets and long-note tails", () => {
    expect(createTimelineRange(110, 790, index, options)).toEqual({
      startMs: 100,
      endMs: 800,
    });
    expect(resizeTimelineRange({ startMs: 100, endMs: 500 }, "end", 790, index, options)).toEqual({
      startMs: 100,
      endMs: 800,
    });
  });

  it("moves a range without changing its duration and snaps its nearest edge", () => {
    expect(moveTimelineRange({ startMs: 100, endMs: 200 }, 190, index, options)).toEqual({
      startMs: 300,
      endMs: 400,
    });
  });

  it("supports modifier-assisted free millisecond placement", () => {
    expect(
      createTimelineRange(110.25, 790.75, index, {
        ...options,
        freePlacement: true,
      }),
    ).toEqual({ startMs: 110.25, endMs: 790.75 });
  });
});

describe("manual timeline input", () => {
  it("parses integer and fractional milliseconds plus mm:ss.mmm", () => {
    expect(parseTimeInput("1250")).toEqual({ ok: true, valueMs: 1_250 });
    expect(parseTimeInput("1250.5")).toEqual({ ok: true, valueMs: 1_250.5 });
    expect(parseTimeInput("02:03.045")).toEqual({ ok: true, valueMs: 123_045 });
  });

  it("keeps invalid and reversed text in an uncommittable draft", () => {
    const invalid = parseManualRangeDraft({ start: "later", end: "1000" }, 2_000);
    const reversed = parseManualRangeDraft({ start: "1500", end: "1000" }, 2_000);

    expect(invalid).toMatchObject({
      ok: false,
      draft: { start: "later", end: "1000" },
      errors: { start: "Use milliseconds or mm:ss.mmm." },
    });
    expect(reversed).toMatchObject({
      ok: false,
      draft: { start: "1500", end: "1000" },
      errors: { range: "End must be greater than start." },
    });
    expect("range" in invalid).toBe(false);
    expect("range" in reversed).toBe(false);
  });

  it("rejects a blank boundary instead of coercing it to zero", () => {
    expect(parseTimeInput("   ")).toEqual({
      error: "Use milliseconds or mm:ss.mmm.",
      ok: false,
    });
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
