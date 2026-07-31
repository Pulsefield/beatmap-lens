import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import { createRenderScene, parseOsu, renderSvg, toManiaChart } from "../src/index";

function foundationScene() {
  return createRenderScene(toManiaChart(parseOsu(foundation4k)));
}

describe("render scene and SVG", () => {
  it("creates a backend-neutral 4K scene", () => {
    const scene = foundationScene();

    expect(scene.kind).toBe("mania-4k");
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

  it("serializes deterministic SVG from either a scene or a chart", () => {
    const scene = foundationScene();
    const svg = renderSvg(scene);
    const chartSvg = renderSvg(toManiaChart(parseOsu(foundation4k)));

    expect(svg).toBe(renderSvg(scene));
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
