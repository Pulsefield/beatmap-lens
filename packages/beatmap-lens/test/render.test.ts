import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import { createRenderScene, parseOsu, renderSvg, serializeSvg, toManiaChart } from "../src/index";

function foundationScene() {
  return createRenderScene(toManiaChart(parseOsu(foundation4k)));
}

describe("render scene and SVG", () => {
  it("creates a backend-neutral mania scene", () => {
    const scene = foundationScene();

    expect(scene.kind).toBe("mania");
    expect(scene.keyCount).toBe(4);
    expect(scene.width).toBe(640);
    expect(scene.height).toBe(408);
    expect(scene.timeRange.pixelsPerSecond).toBe(240);
    expect(scene.lanes.map((lane) => [lane.column, lane.x, lane.width])).toEqual([
      [0, 16, 149],
      [1, 169, 149],
      [2, 322, 149],
      [3, 475, 149],
    ]);
    expect(scene.notes.map((note) => [note.id, note.x, note.y, note.width, note.height])).toEqual([
      ["note-0001", 21, 140, 139, 8],
      ["note-0002", 174, 260, 139, 8],
      ["note-0003", 327, 260, 139, 8],
      ["note-0004", 480, 376, 139, 8],
    ]);
  });

  it("renders detected 10K charts with key-count-aware geometry and titles", () => {
    const chart = toManiaChart(parseOsu(maniaSource(10)));
    const scene = createRenderScene(chart, { laneWidth: 20 });

    expect(scene).toMatchObject({ kind: "mania", keyCount: 10, width: 268 });
    expect(scene.lanes).toHaveLength(10);
    expect(scene.lanes[9]).toMatchObject({ column: 9, x: 232, width: 20 });
    expect(scene.notes[0]).toMatchObject({ column: 9, x: 237, width: 10 });
    expect(serializeSvg(scene)).toContain("<title>10K mania chart</title>");
  });

  it("serializes deterministic SVG from a scene or a chart", () => {
    const scene = foundationScene();
    const svg = serializeSvg(scene);
    const chartSvg = renderSvg(toManiaChart(parseOsu(foundation4k)));

    expect(svg).toBe(serializeSvg(scene));
    expect(chartSvg).toBe(svg);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 408"');
    expect(svg).toContain("<title>Beatmap Lens - Foundation 4K - Normal 4K mania chart</title>");
    expect(svg).toContain(
      'id="note-0001" data-kind="normal" data-source-kind="normal" data-column="0"',
    );
    expect(svg).toContain('data-source-line="21" x="480" y="376" width="139" height="8"');
    expect(svg.endsWith("</svg>\n")).toBe(true);
  });

  it("supports benchmark-style render options", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const scene = createRenderScene(chart, {
      startTime: 0,
      endTime: 8_000,
      width: 640,
      pixelsPerSecond: 120,
    });

    expect(scene.width).toBe(640);
    expect(scene.height).toBe(1008);
    expect(scene.timeRange.pixelsPerSecond).toBe(120);
    expect(
      renderSvg(chart, { startTime: 0, endTime: 8_000, width: 640, pixelsPerSecond: 120 }),
    ).toContain('viewBox="0 0 640 1008"');
  });

  it("clips viewport-crossing long-note geometry to the rendered lane", () => {
    const chart = toManiaChart(
      parseOsu(`osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
64,192,0,128,0,180000:0:0:0:0:
`),
    );
    const scene = createRenderScene(chart, {
      startTime: 60_000,
      endTime: 61_000,
      width: 640,
      pixelsPerSecond: 240,
    });

    expect(scene.notes).toHaveLength(1);
    expect(scene.notes[0]).toMatchObject({
      startTime: 0,
      endTime: 180_000,
      y: scene.padding.top,
      height: scene.lanes[0]?.height,
    });
    expect(scene.notes[0]?.y).toBeGreaterThanOrEqual(scene.padding.top);
    expect((scene.notes[0]?.y ?? 0) + (scene.notes[0]?.height ?? 0)).toBeLessThanOrEqual(
      scene.padding.top + (scene.lanes[0]?.height ?? 0),
    );
  });

  it("rejects impossible render ranges", () => {
    const chart = toManiaChart(parseOsu(foundation4k));

    expect(() =>
      createRenderScene(chart, {
        startTime: 1_000,
        endTime: 1_000,
      }),
    ).toThrowError("endTime must be finite and greater than startTime.");
  });
});

function maniaSource(keyCount: number): string {
  const x = Math.floor(((keyCount - 0.5) * 512) / keyCount);
  return `osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:${keyCount}

[HitObjects]
${x},192,500,1,0,0:0:0:0:
`;
}
