import type { ManiaChart, ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import { chartRenderRange } from "./chart-range";

describe("chartRenderRange", () => {
  it("includes a long note that ends after the final note starts", () => {
    const chart: ManiaChart = {
      keyCount: 4,
      metadata: {},
      notes: [
        note({ endTime: 10_000, kind: "long", sourceKind: "hold", startTime: 0 }),
        note({ endTime: 9_000, id: "later-normal", startTime: 9_000 }),
      ],
      diagnostics: [],
    };

    expect(chartRenderRange(chart)).toEqual({
      startTime: 0,
      endTime: 10_500,
    });
  });
});

function note(overrides: Partial<ManiaNote>): ManiaNote {
  return {
    id: "long-note",
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
