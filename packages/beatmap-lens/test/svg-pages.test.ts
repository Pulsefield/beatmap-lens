import { describe, expect, it } from "vitest";
import { projectTime } from "../src/projection";
import { createRenderDocument } from "../src/render-document";
import { createRenderScene } from "../src/render-scene";
import { renderSvgPages, serializeSvgPages } from "../src/svg-pages";
import type {
  ManiaChart,
  RenderDocument,
  RenderPanel,
  RenderScene,
  RenderTimeAxis,
  TimeRange,
} from "../src/types";

describe("SVG page serialization", () => {
  it("composes fixed-size translated scene groups without nested SVG roots", () => {
    const document = pageDocument();
    const [page] = serializeSvgPages(document, { title: "Review & notes" });

    expect(page).toMatchObject({
      index: 0,
      count: 1,
      range: { startMs: 0, endMs: 2_000 },
      size: { widthPx: 400, heightPx: 200 },
    });
    expect(page?.svg.match(/<svg(?:\s|>)/g)).toHaveLength(1);
    expect(page?.svg).toContain('viewBox="0 0 400 200" width="400" height="200"');
    expect(page?.svg).toContain("<title>Review &amp; notes - page 1 of 1</title>");
    expect(page?.svg).toContain(
      'data-panel-index="0" data-time-scale="linear" transform="translate(10 42)"',
    );
    expect(page?.svg).toContain(
      'data-panel-index="1" data-time-scale="linear" transform="translate(184 42)"',
    );
    expect(page?.svg).toContain('data-layer="time-axis" data-side="right"');
    expect(page?.svg).toContain('data-kind="major" data-time-ms="500"');
    expect(page?.svg).toContain('x="18" y="124"');
  });

  it("scopes panel clip and note IDs while retaining source note identity", () => {
    const document = pageDocument();
    const first = serializeSvgPages(document)[0]?.svg;
    const second = serializeSvgPages(document)[0]?.svg;

    expect(first).toBe(second);
    expect(first).toContain('id="panel-0000-clip"');
    expect(first).toContain('id="panel-0001-clip"');
    expect(first).toContain('id="panel-0000-axis-clip"');
    expect(first).toContain('id="panel-0001-axis-clip"');
    expect(first).toContain('id="panel-0000-note-0001" data-note-id="note-0001"');
    expect(first).toContain('id="panel-0001-note-0002" data-note-id="note-0002"');

    const ids = [...(first?.matchAll(/\sid="([^"]+)"/g) ?? [])].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives a crossing long note panel-scoped DOM IDs and one source identity", () => {
    const chart: ManiaChart = {
      ...fixtureChart(),
      notes: [
        {
          id: "note-0001",
          kind: "long",
          sourceKind: "hold",
          column: 0,
          startMs: 250,
          endMs: 1_750,
          sourceLine: 1,
          x: 64,
          hitSound: 0,
        },
      ],
    };
    const svg = renderSvgPages(chart, {
      range: chart.range,
      page: {
        size: { widthPx: 300, heightPx: 200 },
        paddingPx: 10,
        gapPx: 10,
        columns: 2,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 1_000,
      },
      scale: { type: "linear", pixelsPerSecond: 100 },
      timeAxis: false,
    })[0]?.svg;
    const noteIdentities = [
      ...(svg?.matchAll(/id="(panel-\d{4}-note-0001)" data-note-id="([^"]+)"/g) ?? []),
    ].map((match) => ({ domId: match[1], noteId: match[2] }));

    expect(noteIdentities).toEqual([
      { domId: "panel-0000-note-0001", noteId: "note-0001" },
      { domId: "panel-0001-note-0001", noteId: "note-0001" },
    ]);
    expect(svg).toContain('data-continues-after="true"');
    expect(svg).toContain('data-continues-before="true"');
    const ids = [...(svg?.matchAll(/\sid="([^"]+)"/g) ?? [])].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("attaches the default left axis before the translated and panel-clipped scene", () => {
    const chart = fixtureChart();
    const svg = renderSvgPages(chart, {
      range: { startMs: 0, endMs: 1_000 },
      page: { size: { widthPx: 200, heightPx: 200 }, paddingPx: 10 },
      panel: { playfield: { laneWidthPx: 20 } },
      scale: { type: "linear", pixelsPerSecond: 100 },
    })[0]?.svg;

    expect(svg).toContain('data-layer="scene" transform="translate(32 0)"');
    expect(svg).toContain(
      'data-layer="time-axis" data-side="left" transform="translate(0 0)" clip-path="url(#panel-0000-axis-clip)"',
    );
    expect(svg).toContain('x="14" y="124"');
    expect(svg).toContain('clip-path="url(#panel-0000-clip)"');
  });

  it("adds a page suffix to every custom-sized page title", () => {
    const chart = fixtureChart();
    const document = createRenderDocument(chart, {
      range: chart.range,
      page: { size: { widthPx: 200, heightPx: 200 }, paddingPx: 10, columns: 1 },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 1_000,
      },
      scale: { type: "linear", pixelsPerSecond: 100 },
    });
    const pages = serializeSvgPages(document, { title: "Selection" });

    expect(pages).toHaveLength(2);
    expect(pages[0]?.svg).toContain("<title>Selection - page 1 of 2</title>");
    expect(pages[1]?.svg).toContain("<title>Selection - page 2 of 2</title>");
    expect(pages.every((page) => page.size.widthPx === 200 && page.size.heightPx === 200)).toBe(
      true,
    );
  });

  it("keeps the primary and advanced document paths byte-identical", () => {
    const chart = fixtureChart();
    const options = {
      range: chart.range,
      page: {
        size: { widthPx: 400, heightPx: 200 },
        paddingPx: 10,
        gapPx: 10,
        columns: 2,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 1_000,
      },
      scale: { type: "linear", pixelsPerSecond: 100 },
      timeAxis: { tickStepMs: 500 },
    } as const;
    const svgOptions = { title: "Primary parity" } as const;

    expect(renderSvgPages(chart, options, svgOptions)).toEqual(
      serializeSvgPages(createRenderDocument(chart, options), svgOptions),
    );
  });

  it("marks row-aware compression unless the caller disables marks", () => {
    const chart = fixtureChart();
    const options = {
      range: chart.range,
      page: { size: { widthPx: 200, heightPx: 200 }, paddingPx: 10 },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 2_000,
      },
      scale: {
        type: "row-aware",
        basePixelsPerSecond: 100,
        minRowGapPx: 12,
        maxEmptyGapPx: 20,
      },
    } as const;
    const marked = renderSvgPages(chart, options)[0]?.svg;
    const unmarked = renderSvgPages(chart, {
      ...options,
      timeAxis: { showCompressionMarks: false },
    })[0]?.svg;

    expect(marked).toContain('data-time-scale="row-aware"');
    expect(marked).toContain('data-kind="compression-mark" data-start-ms="0" data-end-ms="2000"');
    expect(unmarked).toContain('data-time-scale="row-aware"');
    expect(unmarked).not.toContain('data-kind="compression-mark"');
  });

  it("fits hour-scale labels inside the clipped narrow axis", () => {
    const range = { startMs: 3_600_000, endMs: 3_601_000 };
    const chart = { ...fixtureChart(), notes: [], range };
    const svg = renderSvgPages(chart, {
      range,
      page: { size: { widthPx: 200, heightPx: 200 }, paddingPx: 10 },
      panel: { playfield: { laneWidthPx: 20 } },
      scale: { type: "linear", pixelsPerSecond: 100 },
      timeAxis: { labels: "bounds", widthPx: 32 },
    })[0]?.svg;

    expect(svg).toContain('clip-path="url(#panel-0000-axis-clip)"');
    expect(svg).toContain('font-family="monospace" font-size="7"');
    expect(svg).toContain('textLength="28" lengthAdjust="spacingAndGlyphs"');
    expect(svg).toContain(">1:00:00.0</text>");
  });
});

function pageDocument(): RenderDocument {
  const chart = fixtureChart();
  const ranges = [
    { startMs: 0, endMs: 1_000 },
    { startMs: 1_000, endMs: 2_000 },
  ] as const;
  const scenes = ranges.map((range) =>
    createRenderScene(chart, {
      range,
      pixelsPerSecond: 100,
      playfield: { laneWidthPx: 20 },
    }),
  );
  const panels = scenes.map(
    (scene, index): RenderPanel => ({
      index,
      range: ranges[index] as TimeRange,
      noteRowCount: 1,
      frame: {
        x: index === 0 ? 10 : 184,
        y: 42,
        width: 164,
        height: 148,
      },
      scene,
      timeAxis: timeAxis(scene),
    }),
  );

  return {
    kind: "mania-document",
    range: { startMs: 0, endMs: 2_000 },
    pageSize: { widthPx: 400, heightPx: 200 },
    resolved: {
      pageSize: { widthPx: 400, heightPx: 200 },
      pagePaddingPx: { top: 10, right: 10, bottom: 10, left: 10 },
      pageGapPx: 10,
      columnsPerPage: 2,
      panelPlayfield: { widthPx: 124, laneWidthPx: 20 },
      panelWidthPx: 164,
      panelContentHeightPx: 132,
      maxNoteRows: 32,
      maxSourceDurationMs: 10_000,
      scale: { type: "linear", pixelsPerSecond: 100 },
      timeDirection: "bottom-to-top",
      timeAxis: {
        side: "right",
        widthPx: 32,
        gapPx: 8,
        labels: "major",
        tickStepMs: 500,
        showCompressionMarks: true,
      },
      panelCount: 2,
      pageCount: 1,
    },
    pages: [
      {
        index: 0,
        size: { widthPx: 400, heightPx: 200 },
        range: { startMs: 0, endMs: 2_000 },
        panels,
      },
    ],
    diagnostics: [],
  };
}

function timeAxis(scene: RenderScene): RenderTimeAxis {
  const { startMs, endMs } = scene.projection.range;
  const middleMs = (startMs + endMs) / 2;
  return {
    side: "right",
    widthPx: 32,
    gapPx: 8,
    labels: "major",
    tickStepMs: 500,
    ticks: [
      {
        kind: "start",
        timeMs: startMs,
        y: projectTime(scene.projection, startMs),
        label: "0:00.0",
      },
      {
        kind: "major",
        timeMs: middleMs,
        y: projectTime(scene.projection, middleMs),
        label: "0:00.5",
      },
      { kind: "end", timeMs: endMs, y: projectTime(scene.projection, endMs), label: "0:01.0" },
    ],
    compressionMarks: [],
  };
}

function fixtureChart(): ManiaChart {
  return {
    keyCount: 4,
    metadata: { artist: "Artist", title: "Title", version: "Hard" },
    notes: [
      {
        id: "note-0001",
        kind: "normal",
        sourceKind: "normal",
        column: 0,
        startMs: 500,
        endMs: 500,
        sourceLine: 1,
        x: 64,
        hitSound: 0,
      },
      {
        id: "note-0002",
        kind: "normal",
        sourceKind: "normal",
        column: 1,
        startMs: 1_500,
        endMs: 1_500,
        sourceLine: 2,
        x: 192,
        hitSound: 0,
      },
    ],
    range: { startMs: 0, endMs: 2_000 },
    diagnostics: [],
  };
}
