import { describe, expect, it } from "vitest";
import { createRenderScene, parseOsu, serializeSvg, toManiaChart } from "../src/index";

const boundarySource = `osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
64,192,500,128,0,1000:0:0:0:0:
192,192,500,128,0,2000:0:0:0:0:
320,192,500,128,0,2500:0:0:0:0:
64,192,1000,1,0,0:0:0:0:
192,192,1000,128,0,2000:0:0:0:0:
320,192,1250,128,0,2250:0:0:0:0:
448,192,1999,1,0,0:0:0:0:
448,192,2000,1,0,0:0:0:0:
64,192,2000,128,0,3000:0:0:0:0:
192,192,3000,1,0,0:0:0:0:
`;

describe("render source-time boundaries", () => {
  it("preserves explicit millisecond fields from parser through SVG", () => {
    const parsed = parseOsu(boundarySource);
    const parsedLongNote = parsed.hitObjects.find((hitObject) => hitObject.timeMs === 1250);

    expect(parsedLongNote).toMatchObject({ kind: "hold", timeMs: 1250 });
    expect(parsedLongNote).not.toHaveProperty("time");

    const chart = toManiaChart(parsed);
    const chartLongNote = chart.notes.find((note) => note.startMs === 1250 && note.endMs === 2250);

    expect(chartLongNote).toMatchObject({ kind: "long", startMs: 1250, endMs: 2250 });
    expect(chartLongNote).not.toHaveProperty("startTime");
    expect(chartLongNote).not.toHaveProperty("endTime");

    const scene = createRenderScene(chart, { range: { startMs: 1000, endMs: 3000 } });
    const glyph = scene.notes.find((note) => note.id === chartLongNote?.id);

    expect(glyph).toMatchObject({ kind: "long", startMs: 1250, endMs: 2250 });
    expect(glyph).not.toHaveProperty("startTime");
    expect(glyph).not.toHaveProperty("endTime");

    const svg = serializeSvg(scene);

    expect(svg).toContain('data-start-ms="1250" data-end-ms="2250"');
    expect(svg).not.toContain("data-start-time=");
    expect(svg).not.toContain("data-end-time=");
  });

  it("partitions taps and long notes across adjacent half-open ranges", () => {
    const chart = toManiaChart(parseOsu(boundarySource));
    const beforeBoundary = createRenderScene(chart, {
      range: { startMs: 1000, endMs: 2000 },
    });
    const afterBoundary = createRenderScene(chart, {
      range: { startMs: 2000, endMs: 3000 },
    });

    expect(noteBoundaryState(beforeBoundary.notes)).toEqual([
      ["long:500-2000", true, false],
      ["long:500-2500", true, true],
      ["normal:1000-1000", false, false],
      ["long:1000-2000", false, false],
      ["long:1250-2250", false, true],
      ["normal:1999-1999", false, false],
    ]);
    expect(noteBoundaryState(afterBoundary.notes)).toEqual([
      ["long:500-2500", true, false],
      ["long:1250-2250", true, false],
      ["normal:2000-2000", false, false],
      ["long:2000-3000", false, false],
    ]);
  });
});

function noteBoundaryState(
  notes: readonly {
    kind: "normal" | "long";
    startMs: number;
    endMs: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
  }[],
): [string, boolean, boolean][] {
  return notes.map((note) => [
    `${note.kind}:${note.startMs}-${note.endMs}`,
    note.continuesBefore,
    note.continuesAfter,
  ]);
}
