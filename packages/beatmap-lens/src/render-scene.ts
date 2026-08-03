import type {
  ManiaChart,
  ManiaNote,
  RenderLane,
  RenderNoteGlyph,
  RenderOptions,
  RenderPadding,
  RenderScene,
} from "./types.js";

const defaultPadding: RenderPadding = {
  top: 24,
  right: 16,
  bottom: 24,
  left: 16,
};

const defaultWidth = 640;
const defaultPixelsPerSecond = 240;

export function createRenderScene(chart: ManiaChart, options: RenderOptions = {}): RenderScene {
  const laneGap = options.laneGap ?? 4;
  const noteHeight = options.noteHeight ?? 8;
  const padding = { ...defaultPadding, ...options.padding };
  const width = round3(options.width ?? widthFromLaneWidth(options.laneWidth, laneGap, padding));
  const pixelsPerSecond = options.pixelsPerSecond ?? defaultPixelsPerSecond;
  const pixelsPerMillisecond = pixelsPerSecond / 1000;
  const startTime = options.startTime ?? 0;
  const naturalEndTime = Math.max(startTime + 1000, ...chart.notes.map((note) => note.endTime));
  const endTime = options.endTime ?? naturalEndTime;
  validateRenderGeometry({
    endTime,
    laneGap,
    noteHeight,
    padding,
    pixelsPerSecond,
    startTime,
    width,
  });
  const laneWidth = round3(
    (width - padding.left - padding.right - (chart.keyCount - 1) * laneGap) / chart.keyCount,
  );
  const contentHeight = Math.max((endTime - startTime) * pixelsPerMillisecond, 96);
  const height = round3(padding.top + contentHeight + padding.bottom);

  const lanes = Array.from({ length: chart.keyCount }, (_, column): RenderLane => {
    const x = round3(padding.left + column * (laneWidth + laneGap));
    return {
      column,
      x,
      y: padding.top,
      width: laneWidth,
      height: round3(contentHeight),
      label: String(column + 1),
      fill: column % 2 === 0 ? "#18232f" : "#1f2d3a",
      stroke: "#314254",
    };
  });

  const visibleNotes = chart.notes.filter((note) =>
    note.kind === "long"
      ? note.endTime > startTime && note.startTime < endTime
      : note.startTime >= startTime && note.startTime <= endTime,
  );
  const notes = visibleNotes.map((note) =>
    createNoteGlyph(note, lanes[note.column] as RenderLane, {
      contentHeight,
      endTime,
      noteHeight,
      startTime,
      pixelsPerMillisecond,
      paddingTop: padding.top,
    }),
  );

  return {
    kind: "mania-4k",
    width,
    height,
    viewBox: [0, 0, width, height],
    timeRange: {
      startTime,
      endTime,
      pixelsPerMillisecond,
      pixelsPerSecond,
    },
    padding,
    metadata: chart.metadata,
    lanes,
    notes,
  };
}

function createNoteGlyph(
  note: ManiaNote,
  lane: RenderLane,
  options: {
    contentHeight: number;
    endTime: number;
    noteHeight: number;
    startTime: number;
    pixelsPerMillisecond: number;
    paddingTop: number;
  },
): RenderNoteGlyph {
  const inset = 5;
  const width = lane.width - inset * 2;
  const laneTop = options.paddingTop;
  const laneBottom = laneTop + options.contentHeight;
  const visibleStartTime = Math.max(note.startTime, options.startTime);
  const visibleEndTime = Math.min(note.endTime, options.endTime);
  const startY = timeToY(
    visibleStartTime,
    options.startTime,
    options.pixelsPerMillisecond,
    options.paddingTop,
  );
  const endY = timeToY(
    visibleEndTime,
    options.startTime,
    options.pixelsPerMillisecond,
    options.paddingTop,
  );
  const isLong = note.kind === "long";
  const effectiveNoteHeight = Math.min(options.noteHeight, options.contentHeight);
  const y = isLong
    ? clamp(startY, laneTop, laneBottom)
    : clamp(startY - effectiveNoteHeight / 2, laneTop, laneBottom - effectiveNoteHeight);
  const height = isLong
    ? Math.min(Math.max(endY - startY, effectiveNoteHeight), Math.max(laneBottom - y, 0))
    : effectiveNoteHeight;

  return {
    id: note.id,
    kind: note.kind,
    sourceKind: note.sourceKind,
    column: note.column,
    startTime: note.startTime,
    endTime: note.endTime,
    x: round3(lane.x + inset),
    y: round3(y),
    width: round3(width),
    height: round3(height),
    radius: 2,
    fill: isLong ? "#4ecdc4" : "#f2c14e",
    stroke: isLong ? "#257a78" : "#916f1d",
    sourceLine: note.sourceLine,
  };
}

function widthFromLaneWidth(
  laneWidth: number | undefined,
  laneGap: number,
  padding: RenderPadding,
): number {
  if (laneWidth === undefined) {
    return defaultWidth;
  }

  return padding.left + padding.right + 4 * laneWidth + 3 * laneGap;
}

function validateRenderGeometry(options: {
  endTime: number;
  laneGap: number;
  noteHeight: number;
  padding: RenderPadding;
  pixelsPerSecond: number;
  startTime: number;
  width: number;
}): void {
  const paddingValues = Object.values(options.padding);
  if (paddingValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Render padding values must be finite and non-negative.");
  }
  if (!Number.isFinite(options.laneGap) || options.laneGap < 0) {
    throw new RangeError("laneGap must be finite and non-negative.");
  }
  if (!Number.isFinite(options.noteHeight) || options.noteHeight <= 0) {
    throw new RangeError("noteHeight must be finite and positive.");
  }
  if (!Number.isFinite(options.pixelsPerSecond) || options.pixelsPerSecond <= 0) {
    throw new RangeError("pixelsPerSecond must be finite and positive.");
  }
  if (
    !Number.isFinite(options.startTime) ||
    !Number.isFinite(options.endTime) ||
    options.endTime <= options.startTime
  ) {
    throw new RangeError("endTime must be finite and greater than startTime.");
  }

  const minimumLaneWidth = 10;
  const minimumWidth =
    options.padding.left + options.padding.right + 3 * options.laneGap + 4 * minimumLaneWidth;
  if (!Number.isFinite(options.width) || options.width < minimumWidth) {
    throw new RangeError(`width must be finite and at least ${minimumWidth}.`);
  }
}

function timeToY(
  time: number,
  startTime: number,
  pixelsPerMillisecond: number,
  paddingTop: number,
): number {
  return round3(paddingTop + (time - startTime) * pixelsPerMillisecond);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
