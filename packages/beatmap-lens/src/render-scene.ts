import { projectTime } from "./projection.js";
import type {
  LinearRenderTimeProjection,
  ManiaChart,
  ManiaNote,
  PlayfieldSize,
  RenderLane,
  RenderMetrics,
  RenderNoteGlyph,
  RenderScene,
  RenderSceneOptions,
  RenderThemeInput,
} from "./types.js";

const defaultMetrics: RenderMetrics = {
  paddingPx: {
    top: 24,
    right: 16,
    bottom: 24,
    left: 16,
  },
  laneGapPx: 4,
  noteHeightPx: 8,
  noteInsetPx: 5,
  noteRadiusPx: 2,
};

const defaultPlayfieldWidthPx = 640;
const defaultPixelsPerSecond = 240;

export function createRenderScene(chart: ManiaChart, options: RenderSceneOptions): RenderScene {
  if (!options?.range) {
    throw new RangeError("A finite render range with startMs and endMs is required.");
  }
  const metrics = resolveMetrics(options.theme);
  const pixelsPerSecond = options.pixelsPerSecond ?? defaultPixelsPerSecond;
  const { startMs, endMs } = options.range;
  const timeDirection = options.timeDirection ?? "bottom-to-top";
  validateRenderInputs({
    endMs,
    metrics,
    pixelsPerSecond,
    startMs,
  });
  const contentHeightPx = ((endMs - startMs) * pixelsPerSecond) / 1000;
  if (!Number.isFinite(contentHeightPx) || contentHeightPx <= 0) {
    throw new RangeError("Resolved contentHeightPx must be finite and positive.");
  }
  const heightPx = metrics.paddingPx.top + contentHeightPx + metrics.paddingPx.bottom;
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    throw new RangeError("Resolved scene heightPx must be finite and positive.");
  }
  const { laneWidthPx, widthPx } = resolvePlayfield(options.playfield, metrics, chart.keyCount);
  validateResolvedPlayfield(laneWidthPx, widthPx, metrics.noteInsetPx);
  const projection: LinearRenderTimeProjection = {
    type: "linear",
    range: { startMs, endMs },
    direction: timeDirection,
    pixelsPerSecond,
    contentTopPx: metrics.paddingPx.top,
    contentHeightPx,
  };

  const lanes = Array.from({ length: chart.keyCount }, (_, column): RenderLane => {
    const x = metrics.paddingPx.left + column * (laneWidthPx + metrics.laneGapPx);
    return {
      column,
      x,
      y: metrics.paddingPx.top,
      width: laneWidthPx,
      height: projection.contentHeightPx,
      label: String(column + 1),
      fill: column % 2 === 0 ? "#18232f" : "#1f2d3a",
      stroke: "#314254",
    };
  });

  const visibleNotes = chart.notes.filter((note) =>
    note.kind === "long"
      ? note.endMs > startMs && note.startMs < endMs
      : note.startMs >= startMs && note.startMs < endMs,
  );
  const notes = visibleNotes.map((note) =>
    createNoteGlyph(note, lanes[note.column] as RenderLane, {
      metrics,
      projection,
    }),
  );

  return {
    kind: "mania",
    keyCount: chart.keyCount,
    size: {
      widthPx,
      heightPx,
    },
    projection,
    metrics,
    metadata: chart.metadata,
    lanes,
    notes,
  };
}

function createNoteGlyph(
  note: ManiaNote,
  lane: RenderLane,
  options: {
    metrics: RenderMetrics;
    projection: LinearRenderTimeProjection;
  },
): RenderNoteGlyph {
  const width = lane.width - options.metrics.noteInsetPx * 2;
  const laneTop = options.projection.contentTopPx;
  const laneBottom = laneTop + options.projection.contentHeightPx;
  const visibleStartMs = Math.max(note.startMs, options.projection.range.startMs);
  const visibleEndMs = Math.min(note.endMs, options.projection.range.endMs);
  const startY = projectTime(options.projection, visibleStartMs);
  const endY = projectTime(options.projection, visibleEndMs);
  const isLong = note.kind === "long";
  const effectiveNoteHeight = Math.min(
    options.metrics.noteHeightPx,
    options.projection.contentHeightPx,
  );
  const y = isLong
    ? clamp(Math.min(startY, endY), laneTop, laneBottom)
    : clamp(startY - effectiveNoteHeight / 2, laneTop, laneBottom - effectiveNoteHeight);
  const height = isLong
    ? Math.min(Math.max(Math.abs(endY - startY), effectiveNoteHeight), Math.max(laneBottom - y, 0))
    : effectiveNoteHeight;

  return {
    id: note.id,
    kind: note.kind,
    sourceKind: note.sourceKind,
    column: note.column,
    startMs: note.startMs,
    endMs: note.endMs,
    continuesBefore: isLong && note.startMs < options.projection.range.startMs,
    continuesAfter: isLong && note.endMs > options.projection.range.endMs,
    x: lane.x + options.metrics.noteInsetPx,
    y,
    width,
    height,
    radius: options.metrics.noteRadiusPx,
    fill: isLong ? "#4ecdc4" : "#f2c14e",
    stroke: isLong ? "#257a78" : "#916f1d",
    sourceLine: note.sourceLine,
  };
}

function resolveMetrics(theme: RenderThemeInput | undefined): RenderMetrics {
  const metrics = theme?.metrics;
  return {
    paddingPx: { ...defaultMetrics.paddingPx, ...metrics?.paddingPx },
    laneGapPx: metrics?.laneGapPx ?? defaultMetrics.laneGapPx,
    noteHeightPx: metrics?.noteHeightPx ?? defaultMetrics.noteHeightPx,
    noteInsetPx: metrics?.noteInsetPx ?? defaultMetrics.noteInsetPx,
    noteRadiusPx: metrics?.noteRadiusPx ?? defaultMetrics.noteRadiusPx,
  };
}

function resolvePlayfield(
  playfield: PlayfieldSize | undefined,
  metrics: RenderMetrics,
  keyCount: ManiaChart["keyCount"],
): { readonly laneWidthPx: number; readonly widthPx: number } {
  const candidate = (playfield ?? { widthPx: defaultPlayfieldWidthPx }) as {
    readonly laneWidthPx?: unknown;
    readonly widthPx?: unknown;
  };
  const hasLaneWidth = Object.hasOwn(candidate, "laneWidthPx");
  const hasWidth = Object.hasOwn(candidate, "widthPx");

  if (hasLaneWidth === hasWidth) {
    throw new RangeError("playfield must define exactly one of widthPx or laneWidthPx.");
  }

  if (hasWidth) {
    assertPositiveFinite(candidate.widthPx, "playfield.widthPx");
    const widthPx = candidate.widthPx;
    return {
      widthPx,
      laneWidthPx:
        (widthPx -
          metrics.paddingPx.left -
          metrics.paddingPx.right -
          (keyCount - 1) * metrics.laneGapPx) /
        keyCount,
    };
  }

  assertPositiveFinite(candidate.laneWidthPx, "playfield.laneWidthPx");
  const laneWidthPx = candidate.laneWidthPx;
  return {
    laneWidthPx,
    widthPx:
      metrics.paddingPx.left +
      keyCount * laneWidthPx +
      (keyCount - 1) * metrics.laneGapPx +
      metrics.paddingPx.right,
  };
}

function validateRenderInputs(options: {
  endMs: number;
  metrics: RenderMetrics;
  pixelsPerSecond: number;
  startMs: number;
}): void {
  const paddingValues = Object.values(options.metrics.paddingPx);
  if (paddingValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("theme.metrics.paddingPx values must be finite and non-negative.");
  }
  if (!Number.isFinite(options.metrics.laneGapPx) || options.metrics.laneGapPx < 0) {
    throw new RangeError("theme.metrics.laneGapPx must be finite and non-negative.");
  }
  if (!Number.isFinite(options.metrics.noteHeightPx) || options.metrics.noteHeightPx <= 0) {
    throw new RangeError("theme.metrics.noteHeightPx must be finite and positive.");
  }
  if (!Number.isFinite(options.metrics.noteInsetPx) || options.metrics.noteInsetPx < 0) {
    throw new RangeError("theme.metrics.noteInsetPx must be finite and non-negative.");
  }
  if (!Number.isFinite(options.metrics.noteRadiusPx) || options.metrics.noteRadiusPx < 0) {
    throw new RangeError("theme.metrics.noteRadiusPx must be finite and non-negative.");
  }
  if (!Number.isFinite(options.pixelsPerSecond) || options.pixelsPerSecond <= 0) {
    throw new RangeError("pixelsPerSecond must be finite and positive.");
  }
  if (
    !Number.isFinite(options.startMs) ||
    !Number.isFinite(options.endMs) ||
    options.endMs <= options.startMs
  ) {
    throw new RangeError("range.endMs must be finite and greater than range.startMs.");
  }
}

function validateResolvedPlayfield(
  laneWidthPx: number,
  widthPx: number,
  noteInsetPx: number,
): void {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    throw new RangeError("Resolved playfield width must be finite and positive.");
  }
  if (!Number.isFinite(laneWidthPx) || laneWidthPx <= noteInsetPx * 2) {
    throw new RangeError("Resolved laneWidthPx must be greater than twice noteInsetPx.");
  }
}

function assertPositiveFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive.`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
