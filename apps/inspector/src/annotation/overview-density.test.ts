import type { ManiaChart, ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import { createOverviewDensityPath } from "./overview-density";

describe("createOverviewDensityPath", () => {
  it("keeps histogram and path complexity fixed as note count grows", () => {
    const sparse = createOverviewDensityPath(chartWithNotes(8), {
      width: 400,
      height: 40,
      resolution: 32,
    });
    const dense = createOverviewDensityPath(chartWithNotes(8_000), {
      width: 400,
      height: 40,
      resolution: 32,
    });

    expect(sparse.counts).toHaveLength(32);
    expect(dense.counts).toHaveLength(32);
    expect(commandCount(sparse.path)).toBe(35);
    expect(commandCount(dense.path)).toBe(35);
    expect(dense.counts.reduce((sum, count) => sum + count, 0)).toBe(8_000);
  });

  it("places a note at the chart end outside the half-open histogram", () => {
    const chart = chartWithNotes(0);
    const withBoundaryNote: ManiaChart = {
      ...chart,
      notes: [note("inside", 999), note("boundary", 1_000)],
    };

    const density = createOverviewDensityPath(withBoundaryNote, {
      width: 100,
      height: 20,
      resolution: 10,
      endMs: 1_000,
    });

    expect(density.counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(density.counts.at(-1)).toBe(1);
  });

  it("builds vertical density with later time at the top", () => {
    const density = createOverviewDensityPath(
      {
        ...chartWithNotes(0),
        notes: [note("early-a", 0), note("early-b", 10), note("middle", 500)],
      },
      {
        width: 10,
        height: 30,
        orientation: "vertical",
        resolution: 3,
        endMs: 1_000,
      },
    );

    expect(density.counts).toEqual([2, 1, 0]);
    expect(density.orientation).toBe("vertical");
    expect(density.path).toBe("M 0 30 L 10 30 L 5 15 L 0 0 L 0 0 Z");
  });
});

function chartWithNotes(count: number): ManiaChart {
  return {
    keyCount: 7,
    metadata: {},
    notes: Array.from({ length: count }, (_, index) => note(`note-${index}`, index)),
    range: { startMs: 0, endMs: Math.max(1, count) },
    diagnostics: [],
  };
}

function note(id: string, startMs: number): ManiaNote {
  return {
    id,
    kind: "normal",
    sourceKind: "normal",
    column: 0,
    startMs,
    endMs: startMs,
    sourceLine: 1,
    x: 64,
    hitSound: 0,
  };
}

function commandCount(path: string): number {
  return path.match(/[MLZ]/g)?.length ?? 0;
}
