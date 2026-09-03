import type { ManiaChart, ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import { chartRenderRange } from "./chart-range";

describe("chartRenderRange", () => {
  it("includes a long note that ends after the final note starts", () => {
    const chart: ManiaChart = {
      keyCount: 4,
      metadata: {},
      notes: [
        note({ endMs: 10_000, kind: "long", sourceKind: "hold", startMs: 0 }),
        note({ endMs: 9_000, id: "later-normal", startMs: 9_000 }),
      ],
      range: { startMs: 0, endMs: 10_001 },
      diagnostics: [],
    };

    expect(chartRenderRange(chart)).toEqual({
      startMs: 0,
      endMs: 10_500,
    });
  });
});

function note(overrides: Partial<ManiaNote>): ManiaNote {
  return {
    id: "long-note",
    kind: "normal",
    sourceKind: "normal",
    column: 0,
    startMs: 0,
    endMs: 0,
    sourceLine: 1,
    x: 64,
    hitSound: 0,
    ...overrides,
  };
}
