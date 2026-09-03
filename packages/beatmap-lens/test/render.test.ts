import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import {
  createRenderScene,
  type ManiaChart,
  parseBeatmap,
  parseOsu,
  renderSvg,
  serializeSvg,
  toManiaChart,
} from "../src/index";

function foundationScene() {
  const chart = toManiaChart(parseOsu(foundation4k));
  return createRenderScene(chart, { range: chart.range });
}

describe("render scene and SVG", () => {
  it("creates a backend-neutral mania scene", () => {
    const scene = foundationScene();

    expect(scene.kind).toBe("mania");
    expect(scene.keyCount).toBe(4);
    expect(scene.projection.direction).toBe("bottom-to-top");
    expect(scene.size).toEqual({ widthPx: 640, heightPx: 408.24 });
    expect(scene).not.toHaveProperty("width");
    expect(scene).not.toHaveProperty("height");
    expect(scene).not.toHaveProperty("viewBox");
    expect(scene).not.toHaveProperty("timeRange");
    expect(scene).not.toHaveProperty("timeDirection");
    expect(scene).not.toHaveProperty("padding");
    expect(scene.projection.pixelsPerSecond).toBe(240);
    expect(scene.metrics).toEqual({
      paddingPx: { top: 24, right: 16, bottom: 24, left: 16 },
      laneGapPx: 4,
      noteHeightPx: 8,
      noteInsetPx: 5,
      noteRadiusPx: 2,
    });
    expect(scene.lanes.map((lane) => [lane.column, lane.x, lane.width])).toEqual([
      [0, 16, 149],
      [1, 169, 149],
      [2, 322, 149],
      [3, 475, 149],
    ]);
    expect(scene.notes.map((note) => [note.id, note.x, note.y, note.width, note.height])).toEqual([
      ["note-0001", 21, 260.24, 139, 8],
      ["note-0002", 174, 140.24, 139, 8],
      ["note-0003", 327, 140.24, 139, 8],
      ["note-0004", 480, 24, 139, 8],
    ]);
  });

  it("renders detected 10K charts with key-count-aware geometry and titles", () => {
    const chart = toManiaChart(parseOsu(maniaSource(10)));
    const scene = createRenderScene(chart, {
      range: chart.range,
      playfield: { laneWidthPx: 20 },
    });

    expect(scene).toMatchObject({
      kind: "mania",
      keyCount: 10,
      size: { widthPx: 268, heightPx: 168.24 },
    });
    expect(scene.lanes).toHaveLength(10);
    expect(scene.lanes[9]).toMatchObject({ column: 9, x: 232, width: 20 });
    expect(scene.notes[0]).toMatchObject({ column: 9, x: 237, width: 10 });
    expect(serializeSvg(scene)).toContain("<title>10K mania chart</title>");
  });

  it("keeps primary and advanced rendering paths byte-identical", () => {
    const beatmap = parseBeatmap(foundation4k);
    const advancedChart = toManiaChart(parseOsu(foundation4k));
    const sceneOptions = {
      range: beatmap.chart.range,
      playfield: { laneWidthPx: 149 },
      pixelsPerSecond: 240,
    } as const;
    const svgOptions = { title: "Explicit render contract" } as const;
    const scene = createRenderScene(advancedChart, sceneOptions);
    const advancedSvg = serializeSvg(scene, svgOptions);
    const primarySvg = renderSvg(beatmap.chart, sceneOptions, svgOptions);

    expect(primarySvg).toBe(advancedSvg);
    expect(primarySvg).toBe(
      serializeSvg(createRenderScene(beatmap.chart, sceneOptions), svgOptions),
    );
    expect(primarySvg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 408.24"',
    );
    expect(primarySvg).toContain("<title>Explicit render contract</title>");
    expect(primarySvg).toContain(
      'id="note-0001" data-kind="normal" data-source-kind="normal" data-column="0"',
    );
    expect(primarySvg).toContain('data-source-line="21" x="480" y="24" width="139" height="8"');
    expect(primarySvg.endsWith("</svg>\n")).toBe(true);
    expect(serializeSvg(foundationScene())).toContain(
      "<title>Beatmap Lens - Foundation 4K - Normal 4K mania chart</title>",
    );
  });

  it("keeps the foundation 4K single-SVG output byte-identical to the baseline", () => {
    expect(serializeSvg(foundationScene())).toBe(foundation4kSvgGolden);
  });

  it("can render time from top to bottom explicitly", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const scene = createRenderScene(chart, {
      range: chart.range,
      timeDirection: "top-to-bottom",
    });

    expect(scene.projection.direction).toBe("top-to-bottom");
    expect(scene.notes.map(({ y }) => y)).toEqual([140, 260, 260, 376.24]);
    expect(renderSvg(chart, { range: chart.range, timeDirection: "top-to-bottom" })).toContain(
      'data-source-line="21" x="480" y="376.24" width="139" height="8"',
    );
  });

  it("supports benchmark-style render options", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const scene = createRenderScene(chart, {
      range: { startMs: 0, endMs: 8_000 },
      playfield: { widthPx: 640 },
      pixelsPerSecond: 120,
    });

    expect(scene.size).toEqual({ widthPx: 640, heightPx: 1008 });
    expect(scene.projection.pixelsPerSecond).toBe(120);
    expect(
      renderSvg(chart, {
        range: { startMs: 0, endMs: 8_000 },
        playfield: { widthPx: 640 },
        pixelsPerSecond: 120,
      }),
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
      range: { startMs: 60_000, endMs: 61_000 },
      pixelsPerSecond: 240,
    });

    expect(scene.notes).toHaveLength(1);
    expect(scene.notes[0]).toMatchObject({
      startMs: 0,
      endMs: 180_000,
      continuesBefore: true,
      continuesAfter: true,
      y: scene.metrics.paddingPx.top,
      height: scene.lanes[0]?.height,
    });
    expect(scene.notes[0]?.y).toBeGreaterThanOrEqual(scene.metrics.paddingPx.top);
    expect((scene.notes[0]?.y ?? 0) + (scene.notes[0]?.height ?? 0)).toBeLessThanOrEqual(
      scene.metrics.paddingPx.top + (scene.lanes[0]?.height ?? 0),
    );
    expect(serializeSvg(scene)).toContain(
      'data-continues-before="true" data-continues-after="true"',
    );
  });

  it("resolves nested theme metrics into every affected geometry field", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const scene = createRenderScene(chart, {
      range: chart.range,
      playfield: { laneWidthPx: 30 },
      theme: {
        metrics: {
          paddingPx: { top: 30, left: 20 },
          laneGapPx: 6,
          noteHeightPx: 12,
          noteInsetPx: 3,
          noteRadiusPx: 4,
        },
      },
    });

    expect(scene.metrics).toEqual({
      paddingPx: { top: 30, right: 16, bottom: 24, left: 20 },
      laneGapPx: 6,
      noteHeightPx: 12,
      noteInsetPx: 3,
      noteRadiusPx: 4,
    });
    expect(scene.size).toEqual({ widthPx: 174, heightPx: 414.24 });
    expect(scene.lanes.map((lane) => [lane.x, lane.y, lane.width])).toEqual([
      [20, 30, 30],
      [56, 30, 30],
      [92, 30, 30],
      [128, 30, 30],
    ]);
    expect(scene.notes[0]).toMatchObject({ x: 23, width: 24, height: 12, radius: 4 });
  });

  it("rejects ambiguous playfield sizing at runtime", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const render = createRenderScene as unknown as (
      chart: ManiaChart,
      options: {
        readonly range: ManiaChart["range"];
        readonly playfield?: Record<string, number>;
      },
    ) => unknown;

    expect(() =>
      render(chart, {
        range: chart.range,
        playfield: { widthPx: 640, laneWidthPx: 120 },
      }),
    ).toThrowError("playfield must define exactly one of widthPx or laneWidthPx.");
    expect(() => render(chart, { range: chart.range, playfield: {} })).toThrowError(
      "playfield must define exactly one of widthPx or laneWidthPx.",
    );
    expect(() => render(chart, { range: chart.range, playfield: { widthPx: 0 } })).toThrowError(
      "playfield.widthPx must be finite and positive.",
    );
    expect(() =>
      render(chart, { range: chart.range, playfield: { laneWidthPx: Number.NaN } }),
    ).toThrowError("playfield.laneWidthPx must be finite and positive.");
  });

  it("rejects resolved lanes that cannot contain the configured note inset", () => {
    const chart = toManiaChart(parseOsu(foundation4k));

    expect(() =>
      createRenderScene(chart, {
        range: chart.range,
        playfield: { laneWidthPx: 10 },
      }),
    ).toThrowError("Resolved laneWidthPx must be greater than twice noteInsetPx.");
    expect(() =>
      createRenderScene(chart, {
        range: chart.range,
        playfield: { laneWidthPx: 20 },
        theme: { metrics: { noteInsetPx: 10 } },
      }),
    ).toThrowError("Resolved laneWidthPx must be greater than twice noteInsetPx.");
  });

  it("derives playfield geometry from one resolved high-precision input", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const fromLaneWidth = createRenderScene(chart, {
      range: chart.range,
      playfield: { laneWidthPx: 20.0006 },
    });
    const fromWidth = createRenderScene(chart, {
      range: chart.range,
      playfield: { widthPx: 640.0016 },
      theme: { metrics: { noteHeightPx: 8.0006, noteInsetPx: 5.0006 } },
    });

    expect(fromLaneWidth.lanes[0]?.width).toBe(20.0006);
    expect(fromLaneWidth.size.widthPx).toBe(124.0024);
    expect(fromWidth.size.widthPx).toBe(640.0016);
    expect(fromWidth.lanes[0]?.width).toBe(149.0004);
    expect(fromWidth.metrics.noteHeightPx).toBe(8.0006);
    expect(fromWidth.metrics.noteInsetPx).toBe(5.0006);

    const firstLane = fromWidth.lanes[0];
    const firstNote = fromWidth.notes[0];
    expect(firstNote?.x).toBe((firstLane?.x ?? 0) + fromWidth.metrics.noteInsetPx);
    expect(firstNote?.width).toBe((firstLane?.width ?? 0) - fromWidth.metrics.noteInsetPx * 2);
    expect(firstNote?.height).toBe(fromWidth.metrics.noteHeightPx);

    for (const scene of [fromLaneWidth, fromWidth]) {
      const padding = scene.metrics.paddingPx;
      const laneWidth = scene.lanes[0]?.width ?? 0;
      const reconstructedWidth =
        padding.left +
        scene.keyCount * laneWidth +
        (scene.keyCount - 1) * scene.metrics.laneGapPx +
        padding.right;
      const lastLane = scene.lanes.at(-1);

      expect(reconstructedWidth).toBe(scene.size.widthPx);
      expect((lastLane?.x ?? 0) + (lastLane?.width ?? 0) + padding.right).toBe(scene.size.widthPx);
    }
  });

  it("keeps repeating lane division consistent with fractional metrics", () => {
    const chart = toManiaChart(parseOsu(maniaSource(7)));
    const widthPx = 701.123456;
    const paddingPx = {
      top: 13.333333,
      right: 12.222222,
      bottom: 14.444444,
      left: 11.111111,
    };
    const laneGapPx = 3.333333;
    const scene = createRenderScene(chart, {
      range: chart.range,
      playfield: { widthPx },
      theme: { metrics: { paddingPx, laneGapPx } },
    });
    const laneWidthPx = scene.lanes[0]?.width ?? 0;
    const reconstructedWidth =
      paddingPx.left +
      chart.keyCount * laneWidthPx +
      (chart.keyCount - 1) * laneGapPx +
      paddingPx.right;
    const lastLane = scene.lanes.at(-1);
    const lastEdge = (lastLane?.x ?? 0) + (lastLane?.width ?? 0) + paddingPx.right;
    const expectedContentHeightPx =
      ((chart.range.endMs - chart.range.startMs) * scene.projection.pixelsPerSecond) / 1000;
    const tolerance = 1e-9;

    expect(scene.size.widthPx).toBe(widthPx);
    expect(Math.abs(reconstructedWidth - scene.size.widthPx)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(lastEdge - scene.size.widthPx)).toBeLessThanOrEqual(tolerance);
    expect(scene.metrics).toEqual({
      paddingPx,
      laneGapPx,
      noteHeightPx: 8,
      noteInsetPx: 5,
      noteRadiusPx: 2,
    });
    expect(scene.lanes[0]?.x).toBe(paddingPx.left);
    expect(scene.projection.contentTopPx).toBe(paddingPx.top);
    expect(scene.lanes[0]?.y).toBe(paddingPx.top);
    expect(scene.projection.contentHeightPx).toBe(expectedContentHeightPx);
    expect(scene.size.heightPx).toBe(paddingPx.top + expectedContentHeightPx + paddingPx.bottom);
  });

  it("preserves valid sub-millipixel scene geometry in SVG output", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const scene = createRenderScene(chart, {
      range: { startMs: 0, endMs: 1 },
      pixelsPerSecond: 0.1,
      playfield: { laneWidthPx: 0.0004 },
      theme: {
        metrics: {
          paddingPx: { top: 0, right: 0, bottom: 0, left: 0 },
          laneGapPx: 0,
          noteHeightPx: 0.0002,
          noteInsetPx: 0,
          noteRadiusPx: 0.0001,
        },
      },
    });
    const svg = serializeSvg(scene);

    expect(scene.size).toEqual({ widthPx: 0.0016, heightPx: 0.0001 });
    expect(svg).toContain('viewBox="0 0 0.0016 0.0001"');
    expect(svg).toContain('width="0.0004" height="0.0001"');
  });

  it.each([
    [{ paddingPx: { left: Number.NaN } }, "paddingPx"],
    [{ laneGapPx: -1 }, "laneGapPx"],
    [{ noteHeightPx: 0 }, "noteHeightPx"],
    [{ noteInsetPx: -1 }, "noteInsetPx"],
    [{ noteRadiusPx: Number.POSITIVE_INFINITY }, "noteRadiusPx"],
  ] as const)("rejects invalid resolved metric %o", (metrics, message) => {
    const chart = toManiaChart(parseOsu(foundation4k));

    expect(() =>
      createRenderScene(chart, {
        range: chart.range,
        theme: { metrics },
      }),
    ).toThrowError(message);
  });

  it("rejects impossible render ranges", () => {
    const chart = toManiaChart(parseOsu(foundation4k));

    expect(() =>
      createRenderScene(chart, {
        range: { startMs: 1_000, endMs: 1_000 },
      }),
    ).toThrowError("range.endMs must be finite and greater than range.startMs.");
  });

  it("rejects non-finite derived scene heights before generating geometry", () => {
    const chart = { ...toManiaChart(parseOsu(foundation4k)), notes: [] };

    expect(() =>
      createRenderScene(chart, {
        range: { startMs: 0, endMs: Number.MAX_VALUE },
        pixelsPerSecond: Number.MAX_VALUE,
      }),
    ).toThrowError("Resolved contentHeightPx must be finite and positive.");
    expect(() =>
      createRenderScene(chart, {
        range: { startMs: 0, endMs: 1 },
        pixelsPerSecond: Number.MAX_VALUE,
        theme: { metrics: { paddingPx: { top: Number.MAX_VALUE } } },
      }),
    ).toThrowError("Resolved scene heightPx must be finite and positive.");
  });

  it("rejects missing and non-finite render ranges at runtime", () => {
    const chart = toManiaChart(parseOsu(foundation4k));
    const createFromRuntime = createRenderScene as unknown as (
      chart: ManiaChart,
      options?: { readonly range?: { readonly startMs?: number; readonly endMs?: number } },
    ) => unknown;

    expect(() => createFromRuntime(chart)).toThrowError(RangeError);
    expect(() => createFromRuntime(chart, {})).toThrowError(RangeError);
    expect(() => createFromRuntime(chart, { range: { startMs: 0 } })).toThrowError(RangeError);
    expect(() =>
      createFromRuntime(chart, { range: { startMs: 0, endMs: Number.POSITIVE_INFINITY } }),
    ).toThrowError(RangeError);
    expect(() => createFromRuntime(chart, { range: { startMs: 2, endMs: 1 } })).toThrowError(
      RangeError,
    );
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

const foundation4kSvgGolden = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 408.24" width="640" height="408.24" role="img" aria-label="Beatmap Lens - Foundation 4K - Normal 4K mania chart">
  <title>Beatmap Lens - Foundation 4K - Normal 4K mania chart</title>
  <rect x="0" y="0" width="640" height="408.24" fill="#101820"/>
  <g data-layer="lanes">
    <rect data-column="0" x="16" y="24" width="149" height="360.24" fill="#18232f" stroke="#314254"/>
    <rect data-column="1" x="169" y="24" width="149" height="360.24" fill="#1f2d3a" stroke="#314254"/>
    <rect data-column="2" x="322" y="24" width="149" height="360.24" fill="#18232f" stroke="#314254"/>
    <rect data-column="3" x="475" y="24" width="149" height="360.24" fill="#1f2d3a" stroke="#314254"/>
  </g>
  <g data-layer="notes">
    <rect id="note-0001" data-kind="normal" data-source-kind="normal" data-column="0" data-start-ms="500" data-end-ms="500" data-source-line="18" x="21" y="260.24" width="139" height="8" rx="2" fill="#f2c14e" stroke="#916f1d"/>
    <rect id="note-0002" data-kind="normal" data-source-kind="normal" data-column="1" data-start-ms="1000" data-end-ms="1000" data-source-line="19" x="174" y="140.24" width="139" height="8" rx="2" fill="#f2c14e" stroke="#916f1d"/>
    <rect id="note-0003" data-kind="normal" data-source-kind="normal" data-column="2" data-start-ms="1000" data-end-ms="1000" data-source-line="20" x="327" y="140.24" width="139" height="8" rx="2" fill="#f2c14e" stroke="#916f1d"/>
    <rect id="note-0004" data-kind="normal" data-source-kind="normal" data-column="3" data-start-ms="1500" data-end-ms="1500" data-source-line="21" x="480" y="24" width="139" height="8" rx="2" fill="#f2c14e" stroke="#916f1d"/>
  </g>
</svg>
`;
