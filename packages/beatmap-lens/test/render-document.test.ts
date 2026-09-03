import { describe, expect, it } from "vitest";
import { createRenderDocument, type ManiaChart, type ManiaNote, projectTime } from "../src/index";

describe("render document planning", () => {
  it("exposes every chart- and page-resolved document default", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: 0, endMs: 1_000 },
    });

    expect(document.resolved).toEqual({
      pageSize: { widthPx: 1_600, heightPx: 900 },
      pagePaddingPx: { top: 24, right: 24, bottom: 24, left: 24 },
      pageGapPx: 12,
      columnsPerPage: 5,
      panelPlayfield: { widthPx: 236, laneWidthPx: 48 },
      panelWidthPx: 268,
      panelContentHeightPx: 804,
      maxNoteRows: 32,
      maxSourceDurationMs: 10_000,
      scale: { type: "linear", pixelsPerSecond: 240 },
      timeDirection: "bottom-to-top",
      timeAxis: {
        side: "left",
        widthPx: 32,
        gapPx: 0,
        labels: "major",
        tickStepMs: "auto",
        showCompressionMarks: true,
      },
      panelCount: 1,
      pageCount: 1,
    });
  });

  it("partitions linear panels, packs pages, and preserves boundary note semantics", () => {
    const document = createRenderDocument(
      chart([normal(0, 0), long(500, 2_200, 1), normal(1_000, 2), normal(2_000, 3)]),
      {
        range: { startMs: 0, endMs: 2_500 },
        page: {
          size: { widthPx: 358, heightPx: 200 },
          paddingPx: 10,
          gapPx: 10,
        },
        panel: {
          playfield: { laneWidthPx: 20 },
          maxNoteRows: "unbounded",
          maxSourceDurationMs: 1_000,
        },
        scale: { type: "linear", pixelsPerSecond: 100 },
        timeAxis: { labels: "bounds" },
      },
    );

    expect(document.resolved).toMatchObject({
      pageSize: { widthPx: 358, heightPx: 200 },
      pagePaddingPx: { top: 10, right: 10, bottom: 10, left: 10 },
      columnsPerPage: 2,
      panelPlayfield: { widthPx: 124, laneWidthPx: 20 },
      panelWidthPx: 156,
      panelContentHeightPx: 132,
      panelCount: 3,
      pageCount: 2,
    });
    expect(document.pages.map((page) => page.size)).toEqual([
      { widthPx: 358, heightPx: 200 },
      { widthPx: 358, heightPx: 200 },
    ]);
    expect(document.pages.flatMap((page) => page.panels.map((panel) => panel.range))).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 2_000, endMs: 2_500 },
    ]);
    expect(document.pages[0]?.panels.map((panel) => panel.frame.x)).toEqual([10, 176]);
    expect(document.pages.flatMap((page) => page.panels.map((panel) => panel.frame.y))).toEqual([
      42, 42, 92,
    ]);
    expect(document.pages[1]?.panels[0]?.frame.x).toBe(10);
    expect(
      document.pages.flatMap((page) => page.panels.map((panel) => panel.noteRowCount)),
    ).toEqual([2, 1, 1]);

    const longNoteGlyphs = document.pages
      .flatMap((page) => page.panels)
      .flatMap((panel) => panel.scene.notes)
      .filter((note) => note.kind === "long");
    expect(
      longNoteGlyphs.map(({ continuesBefore, continuesAfter }) => [
        continuesBefore,
        continuesAfter,
      ]),
    ).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
    expect(document.pages[0]?.panels[0]?.timeAxis?.ticks.map((tick) => tick.kind)).toEqual([
      "start",
      "end",
    ]);
  });

  it("counts chords as one row and breaks before the next distinct row", () => {
    const document = createRenderDocument(
      chart([normal(100, 0), normal(100, 1), normal(200, 2), normal(300, 3)]),
      {
        range: { startMs: 0, endMs: 400 },
        page: { size: { widthPx: 300, heightPx: 500 }, paddingPx: 10 },
        panel: {
          playfield: { laneWidthPx: 20 },
          maxNoteRows: 1,
          maxSourceDurationMs: 10_000,
        },
        scale: { type: "linear", pixelsPerSecond: 100 },
        timeAxis: false,
      },
    );

    const panels = document.pages.flatMap((page) => page.panels);
    expect(panels.map((panel) => panel.range)).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 200, endMs: 300 },
      { startMs: 300, endMs: 400 },
    ]);
    expect(panels.map((panel) => panel.noteRowCount)).toEqual([1, 1, 1]);
    expect(panels.map((panel) => panel.scene.notes.map((note) => note.startMs))).toEqual([
      [100, 100],
      [200],
      [300],
    ]);
    expect(panels.every((panel) => panel.timeAxis === undefined)).toBe(true);
  });

  it("top-aligns short top-to-bottom panels", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: 0, endMs: 500 },
      page: { size: { widthPx: 220, heightPx: 200 }, paddingPx: 10 },
      panel: { playfield: { laneWidthPx: 20 } },
      scale: { type: "linear", pixelsPerSecond: 100 },
      timeDirection: "top-to-bottom",
    });

    expect(document.pages[0]?.panels[0]?.frame).toMatchObject({ y: 10, height: 98 });
  });

  it("rejects a panel or explicit column count that cannot fit without shrinking lanes", () => {
    const common = {
      range: { startMs: 0, endMs: 1_000 },
      panel: { playfield: { laneWidthPx: 20 } },
    } as const;

    expect(() =>
      createRenderDocument(chart([]), {
        ...common,
        page: { size: { widthPx: 175, heightPx: 300 }, paddingPx: 10 },
      }),
    ).toThrowError(RangeError);
    expect(() =>
      createRenderDocument(chart([]), {
        ...common,
        page: {
          size: { widthPx: 358, heightPx: 300 },
          paddingPx: 10,
          gapPx: 10,
          columns: 3,
        },
      }),
    ).toThrowError(RangeError);
  });

  it("chooses the greatest global fit scale that preserves the minimum page count", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: 0, endMs: 5_000 },
      page: {
        size: { widthPx: 358, heightPx: 168 },
        paddingPx: 10,
        gapPx: 10,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000,
      },
      scale: {
        type: "fit",
        preferredPixelsPerSecond: 100,
        minPixelsPerSecond: 20,
      },
      timeAxis: { labels: "bounds" },
    });

    expect(document.resolved.scale).toMatchObject({
      type: "fit",
      preferredPixelsPerSecond: 100,
      minPixelsPerSecond: 20,
      pixelsPerSecond: 40,
    });
    expect(document.resolved.pageCount).toBe(1);
    expect(document.resolved.panelCount).toBe(2);
    expect(
      document.pages
        .flatMap((page) => page.panels)
        .map((panel) =>
          panel.scene.projection.type === "linear"
            ? panel.scene.projection.pixelsPerSecond
            : undefined,
        ),
    ).toEqual([40, 40]);
    expect(document.diagnostics).toEqual([]);
  });

  it("retains the preferred fit scale when rows or duration already determine page count", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: 0, endMs: 4_000 },
      page: {
        size: { widthPx: 220, heightPx: 300 },
        paddingPx: 10,
        columns: 1,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 1_000,
      },
      scale: {
        type: "fit",
        preferredPixelsPerSecond: 100,
        minPixelsPerSecond: 20,
      },
    });

    expect(document.resolved.scale).toMatchObject({ pixelsPerSecond: 100 });
    expect(document.resolved.pageCount).toBe(4);
    expect(document.diagnostics).toEqual([]);
  });

  it("does not report fit minimum when the configured fit interval is a point", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: 0, endMs: 3_000 },
      page: {
        size: { widthPx: 220, heightPx: 300 },
        paddingPx: 10,
        columns: 1,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxSourceDurationMs: 1_000,
      },
      scale: {
        type: "fit",
        preferredPixelsPerSecond: 50,
        minPixelsPerSecond: 50,
      },
    });

    expect(document.resolved.pageCount).toBe(3);
    expect(document.resolved.scale).toMatchObject({ pixelsPerSecond: 50 });
    expect(document.diagnostics).toEqual([]);
  });

  it("reports fit reaching its minimum only when it still needs multiple pages", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: 0, endMs: 3_200 },
      page: {
        size: { widthPx: 220, heightPx: 148 },
        paddingPx: 10,
        columns: 1,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000,
      },
      scale: {
        type: "fit",
        preferredPixelsPerSecond: 100,
        minPixelsPerSecond: 50,
      },
    });

    expect(document.resolved.scale).toMatchObject({ pixelsPerSecond: 50 });
    expect(document.resolved.pageCount).toBe(2);
    expect(document.diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", code: "fit-minimum-reached" }),
    ]);
  });

  it("expands dense rows, compresses inactive gaps, and derives axis marks", () => {
    const document = createRenderDocument(
      chart([normal(1_000, 0), normal(1_000, 1), normal(1_050, 2)]),
      {
        range: { startMs: 0, endMs: 10_000 },
        page: { size: { widthPx: 220, heightPx: 224 }, paddingPx: 10 },
        panel: {
          playfield: { laneWidthPx: 20 },
          maxNoteRows: "unbounded",
          maxSourceDurationMs: 10_000,
        },
        scale: {
          type: "row-aware",
          basePixelsPerSecond: 100,
          minRowGapPx: 12,
          maxEmptyGapPx: 72,
        },
      },
    );

    const panel = document.pages[0]?.panels[0];
    expect(panel?.scene.projection).toMatchObject({
      type: "piecewise-linear",
      contentHeightPx: 156,
      anchors: [
        { timeMs: 0, distancePx: 0 },
        { timeMs: 1_000, distancePx: 72 },
        { timeMs: 1_050, distancePx: 84 },
        { timeMs: 10_000, distancePx: 156 },
      ],
      compressedRanges: [
        { startMs: 0, endMs: 1_000 },
        { startMs: 1_050, endMs: 10_000 },
      ],
    });
    expect(panel?.noteRowCount).toBe(2);
    expect(panel?.timeAxis?.compressionMarks.map((mark) => mark.range)).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_050, endMs: 10_000 },
    ]);
    expect(panel?.timeAxis?.compressionMarks.map((mark) => mark.y)).toEqual(
      panel?.scene.projection.type === "piecewise-linear"
        ? panel.scene.projection.compressedRanges.map((range) =>
            projectTime(panel.scene.projection, (range.startMs + range.endMs) / 2),
          )
        : [],
    );
  });

  it("splits overflowing active long-note time without compressing its baseline", () => {
    const document = createRenderDocument(chart([long(1_000, 9_000, 0)]), {
      range: { startMs: 0, endMs: 10_000 },
      page: {
        size: { widthPx: 220, heightPx: 368 },
        paddingPx: 10,
        columns: 1,
      },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000,
      },
      scale: {
        type: "row-aware",
        basePixelsPerSecond: 100,
        minRowGapPx: 12,
        maxEmptyGapPx: 72,
      },
    });

    const panels = document.pages.flatMap((page) => page.panels);
    expect(panels.map((panel) => panel.range)).toEqual([
      { startMs: 0, endMs: 3_280 },
      { startMs: 3_280, endMs: 6_280 },
      { startMs: 6_280, endMs: 9_000 },
      { startMs: 9_000, endMs: 10_000 },
    ]);
    expect(panels.map((panel) => panel.scene.projection.contentHeightPx)).toEqual([
      300, 300, 272, 72,
    ]);
    expect(
      panels.map((panel) => {
        const glyph = panel.scene.notes[0];
        return glyph ? [glyph.continuesBefore, glyph.continuesAfter] : undefined;
      }),
    ).toEqual([[false, true], [true, true], [true, false], undefined]);
  });

  it("falls back to an in-interval cut when a note-row prefix still overflows an active LN", () => {
    const document = createRenderDocument(chart([long(0, 5_000, 0), normal(2_000, 1)]), {
      range: { startMs: 0, endMs: 2_500 },
      page: { size: { widthPx: 220, heightPx: 168 }, paddingPx: 10, columns: 1 },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000,
      },
      scale: {
        type: "row-aware",
        basePixelsPerSecond: 100,
        minRowGapPx: 12,
        maxEmptyGapPx: 72,
      },
    });

    const panels = document.pages.flatMap((page) => page.panels);
    expect(panels.slice(0, 2).map((panel) => panel.range)).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
    ]);
    expect(panels[0]?.scene.notes[0]).toMatchObject({
      kind: "long",
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(panels[1]?.scene.notes[0]).toMatchObject({
      kind: "long",
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(panels[2]?.scene.notes.map((note) => note.startMs)).toEqual([0, 2_000]);
  });

  it("nudges an uncapped row-aware cut down when float rounding exceeds capacity", () => {
    const document = createRenderDocument(chart([long(100, 1_000, 0)]), {
      range: { startMs: 0, endMs: 1_000 },
      page: { size: { widthPx: 220, heightPx: 88 }, paddingPx: 10, columns: 1 },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000,
      },
      scale: {
        type: "row-aware",
        basePixelsPerSecond: 41,
        minRowGapPx: 1,
        maxEmptyGapPx: 1,
      },
    });

    const panels = document.pages.flatMap((page) => page.panels);
    const naiveCutMs = 100 + (19 * 1_000) / 41;
    expect(panels[0]?.range.endMs).toBeLessThan(naiveCutMs);
    expect(panels[0]?.range.endMs).toBeGreaterThan(100);
    expect(panels[1]?.range.startMs).toBe(panels[0]?.range.endMs);
    expect(
      panels.every(
        (panel) => panel.scene.projection.contentHeightPx <= document.resolved.panelContentHeightPx,
      ),
    ).toBe(true);
  });

  it("moves a complete overflowing inactive capped gap to the next panel", () => {
    const document = createRenderDocument(chart([normal(1_000, 0)]), {
      range: { startMs: 0, endMs: 10_000 },
      page: { size: { widthPx: 220, heightPx: 168 }, paddingPx: 10, columns: 1 },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000,
      },
      scale: {
        type: "row-aware",
        basePixelsPerSecond: 100,
        minRowGapPx: 12,
        maxEmptyGapPx: 72,
      },
    });

    const panels = document.pages.flatMap((page) => page.panels);
    expect(panels.map((panel) => panel.range)).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 10_000 },
    ]);
    expect(panels.map((panel) => panel.scene.projection.contentHeightPx)).toEqual([72, 72]);
    expect(panels[0]?.noteRowCount).toBe(0);
    expect(panels[1]?.noteRowCount).toBe(1);
  });

  it("uses an absolute-zero tick grid and signed source-time labels across one hour", () => {
    const document = createRenderDocument(chart([]), {
      range: { startMs: -1_050, endMs: 3_600_050 },
      page: { size: { widthPx: 220, heightPx: 168 }, paddingPx: 10 },
      panel: {
        playfield: { laneWidthPx: 20 },
        maxNoteRows: "unbounded",
        maxSourceDurationMs: 10_000_000,
      },
      scale: {
        type: "row-aware",
        basePixelsPerSecond: 100,
        minRowGapPx: 12,
        maxEmptyGapPx: 72,
      },
      timeAxis: { tickStepMs: 1_000_000 },
    });

    const ticks = document.pages[0]?.panels[0]?.timeAxis?.ticks;
    expect(ticks?.[0]).toMatchObject({ kind: "start", timeMs: -1_050, label: "-0:01.1" });
    expect(ticks?.at(-1)).toMatchObject({
      kind: "end",
      timeMs: 3_600_050,
      label: "1:00:00.1",
    });
    expect(ticks?.filter((tick) => tick.kind === "major").map((tick) => tick.timeMs)).toEqual([
      1_000_000, 2_000_000,
    ]);
  });

  it.each(["minRowGapPx", "maxEmptyGapPx"] as const)(
    "rejects row-aware %s above panel content capacity",
    (name) => {
      expect(() =>
        createRenderDocument(chart([]), {
          range: { startMs: 0, endMs: 1_000 },
          page: { size: { widthPx: 220, heightPx: 168 }, paddingPx: 10 },
          panel: { playfield: { laneWidthPx: 20 } },
          scale: {
            type: "row-aware",
            basePixelsPerSecond: 100,
            minRowGapPx: 12,
            maxEmptyGapPx: 72,
            [name]: 101,
          },
        }),
      ).toThrowError(RangeError);
    },
  );

  it.each([
    [{ page: { size: { widthPx: 0, heightPx: 100 } } }, "page size"],
    [{ page: { paddingPx: -1 } }, "padding"],
    [{ page: { columns: 1.5 } }, "columns"],
    [{ panel: { maxNoteRows: 0 } }, "row limit"],
    [{ panel: { maxSourceDurationMs: Number.NaN } }, "duration"],
    [{ timeAxis: { widthPx: 0 } }, "axis width"],
    [
      { scale: { type: "fit", preferredPixelsPerSecond: 100, minPixelsPerSecond: 101 } },
      "fit interval",
    ],
  ] as const)("rejects invalid numeric document inputs: %s", (partial, _label) => {
    expect(() =>
      createRenderDocument(chart([]), {
        range: { startMs: 0, endMs: 1_000 },
        ...partial,
      }),
    ).toThrowError(RangeError);
  });
});

function chart(notes: readonly ManiaNote[]): ManiaChart {
  return {
    keyCount: 4,
    metadata: {},
    notes: [...notes].sort((left, right) => left.startMs - right.startMs),
    range: { startMs: 0, endMs: 10_001 },
    diagnostics: [],
  };
}

function normal(startMs: number, column: number): ManiaNote {
  return note("normal", startMs, startMs, column);
}

function long(startMs: number, endMs: number, column: number): ManiaNote {
  return note("long", startMs, endMs, column);
}

function note(kind: ManiaNote["kind"], startMs: number, endMs: number, column: number): ManiaNote {
  return {
    id: `note-${startMs}-${column}`,
    kind,
    sourceKind: kind === "long" ? "hold" : "normal",
    column,
    startMs,
    endMs,
    sourceLine: 1,
    x: column * 128 + 64,
    hitSound: 0,
  };
}
