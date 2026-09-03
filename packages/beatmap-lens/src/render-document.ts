import { projectTime } from "./projection.js";
import { renderDefaults } from "./render-defaults.js";
import {
  createRenderSceneFromProjection,
  type ResolvedRenderSceneStyle,
  resolveRenderSceneStyle,
} from "./render-scene.js";
import type {
  LinearRenderTimeProjection,
  ManiaChart,
  PiecewiseLinearRenderTimeProjection,
  RenderDiagnostic,
  RenderDocument,
  RenderDocumentOptions,
  RenderPadding,
  RenderPaddingInput,
  RenderPanel,
  RenderTimeAxis,
  RenderTimeAxisTick,
  RenderTimeDirection,
  RenderTimeProjection,
  ResolvedRenderDocumentOptions,
  ResolvedRenderDocumentScale,
  ResolvedRenderTimeAxisOptions,
  TimeRange,
} from "./types.js";

interface DocumentLayout {
  readonly range: TimeRange;
  readonly style: ResolvedRenderSceneStyle;
  readonly pageSize: { readonly widthPx: number; readonly heightPx: number };
  readonly pagePaddingPx: RenderPadding;
  readonly pageGapPx: number;
  readonly columnsPerPage: number;
  readonly panelWidthPx: number;
  readonly panelContentHeightPx: number;
  readonly maxNoteRows: number | "unbounded";
  readonly maxSourceDurationMs: number;
  readonly timeDirection: RenderTimeDirection;
  readonly timeAxis: false | ResolvedRenderTimeAxisOptions;
  readonly rowTimes: readonly number[];
}

interface PlannedPanel {
  readonly range: TimeRange;
  readonly noteRowCount: number;
  readonly projection: RenderTimeProjection;
}

interface ResolvedInterval {
  readonly startMs: number;
  readonly endMs: number;
  readonly baselineDistancePx: number;
  readonly distancePx: number;
  readonly capped: boolean;
}

interface ResolvedPiecewiseProjection {
  readonly projection: PiecewiseLinearRenderTimeProjection;
  readonly intervals: readonly ResolvedInterval[];
}

export function createRenderDocument(
  chart: ManiaChart,
  options: RenderDocumentOptions,
): RenderDocument {
  const layout = resolveDocumentLayout(chart, options);
  const scaleInput = options.scale ?? renderDefaults.document.scale;
  let scale: ResolvedRenderDocumentScale;
  let plannedPanels: readonly PlannedPanel[];
  const diagnostics: RenderDiagnostic[] = [];

  if (scaleInput.type === "linear") {
    const pixelsPerSecond =
      scaleInput.pixelsPerSecond ?? renderDefaults.document.scale.pixelsPerSecond;
    assertPositiveFinite(pixelsPerSecond, "scale.pixelsPerSecond");
    scale = { type: "linear", pixelsPerSecond };
    plannedPanels = planLinearPanels(layout, pixelsPerSecond);
  } else if (scaleInput.type === "fit") {
    const preferredPixelsPerSecond =
      scaleInput.preferredPixelsPerSecond ?? renderDefaults.document.fit.preferredPixelsPerSecond;
    const minPixelsPerSecond =
      scaleInput.minPixelsPerSecond ?? renderDefaults.document.fit.minPixelsPerSecond;
    assertPositiveFinite(preferredPixelsPerSecond, "scale.preferredPixelsPerSecond");
    assertPositiveFinite(minPixelsPerSecond, "scale.minPixelsPerSecond");
    if (minPixelsPerSecond > preferredPixelsPerSecond) {
      throw new RangeError(
        "scale.minPixelsPerSecond must be less than or equal to scale.preferredPixelsPerSecond.",
      );
    }

    const minimumPlan = planLinearPanels(layout, minPixelsPerSecond);
    const minimumPageCount = pageCount(minimumPlan.length, layout.columnsPerPage);
    const preferredPlan = planLinearPanels(layout, preferredPixelsPerSecond);
    const preferredPageCount = pageCount(preferredPlan.length, layout.columnsPerPage);
    let pixelsPerSecond = preferredPixelsPerSecond;

    if (preferredPageCount !== minimumPageCount) {
      let fitting = minPixelsPerSecond;
      let overflowing = preferredPixelsPerSecond;
      for (let iteration = 0; iteration < 64; iteration += 1) {
        const candidate = (fitting + overflowing) / 2;
        const candidatePageCount = pageCount(
          planLinearPanels(layout, candidate).length,
          layout.columnsPerPage,
        );
        if (candidatePageCount === minimumPageCount) fitting = candidate;
        else overflowing = candidate;
      }
      pixelsPerSecond = fitting;
    }

    scale = {
      type: "fit",
      preferredPixelsPerSecond,
      minPixelsPerSecond,
      pixelsPerSecond,
    };
    plannedPanels = planLinearPanels(layout, pixelsPerSecond);
    if (
      preferredPageCount > minimumPageCount &&
      pixelsPerSecond === minPixelsPerSecond &&
      minimumPageCount > 1
    ) {
      diagnostics.push({
        severity: "warning",
        code: "fit-minimum-reached",
        message:
          "The minimum fit scale was reached and the document still requires multiple pages.",
      });
    }
  } else if (scaleInput.type === "row-aware") {
    const basePixelsPerSecond =
      scaleInput.basePixelsPerSecond ?? renderDefaults.document.rowAware.basePixelsPerSecond;
    const minRowGapPx = scaleInput.minRowGapPx ?? renderDefaults.document.rowAware.minRowGapPx;
    const maxEmptyGapPx =
      scaleInput.maxEmptyGapPx ?? renderDefaults.document.rowAware.maxEmptyGapPx;
    assertPositiveFinite(basePixelsPerSecond, "scale.basePixelsPerSecond");
    assertPositiveFinite(minRowGapPx, "scale.minRowGapPx");
    assertPositiveFinite(maxEmptyGapPx, "scale.maxEmptyGapPx");
    if (minRowGapPx > layout.panelContentHeightPx) {
      throw new RangeError("scale.minRowGapPx must not exceed the panel content-height capacity.");
    }
    if (maxEmptyGapPx > layout.panelContentHeightPx) {
      throw new RangeError(
        "scale.maxEmptyGapPx must not exceed the panel content-height capacity.",
      );
    }

    scale = { type: "row-aware", basePixelsPerSecond, minRowGapPx, maxEmptyGapPx };
    plannedPanels = planRowAwarePanels(chart, layout, scale);
  } else {
    throw new RangeError("scale.type must be linear, fit, or row-aware.");
  }

  return assembleDocument(chart, layout, scale, plannedPanels, diagnostics);
}

function resolveDocumentLayout(chart: ManiaChart, options: RenderDocumentOptions): DocumentLayout {
  if (!options?.range) {
    throw new RangeError("A finite render range with startMs and endMs is required.");
  }
  const range = options.range;
  if (
    !Number.isFinite(range.startMs) ||
    !Number.isFinite(range.endMs) ||
    range.endMs <= range.startMs
  ) {
    throw new RangeError("range.endMs must be finite and greater than range.startMs.");
  }

  const pageSize = options.page?.size ?? renderDefaults.document.page.size;
  assertPositiveFinite(pageSize.widthPx, "page.size.widthPx");
  assertPositiveFinite(pageSize.heightPx, "page.size.heightPx");
  const pagePaddingPx = resolvePadding(options.page?.paddingPx);
  const pageGapPx = options.page?.gapPx ?? renderDefaults.document.page.gapPx;
  assertNonNegativeFinite(pageGapPx, "page.gapPx");
  const innerWidthPx = pageSize.widthPx - pagePaddingPx.left - pagePaddingPx.right;
  const innerHeightPx = pageSize.heightPx - pagePaddingPx.top - pagePaddingPx.bottom;
  if (!Number.isFinite(innerWidthPx) || innerWidthPx <= 0) {
    throw new RangeError("Page padding must leave a positive inner width.");
  }
  if (!Number.isFinite(innerHeightPx) || innerHeightPx <= 0) {
    throw new RangeError("Page padding must leave a positive inner height.");
  }

  const style = resolveRenderSceneStyle(
    chart,
    options.panel?.playfield ?? renderDefaults.document.panel.playfield,
    options.theme,
  );
  const panelContentHeightPx =
    innerHeightPx - style.metrics.paddingPx.top - style.metrics.paddingPx.bottom;
  if (!Number.isFinite(panelContentHeightPx) || panelContentHeightPx <= 0) {
    throw new RangeError("One complete panel does not fit inside the page inner height.");
  }

  const timeAxis = resolveTimeAxisOptions(options.timeAxis);
  const panelWidthPx =
    style.playfield.widthPx + (timeAxis === false ? 0 : timeAxis.gapPx + timeAxis.widthPx);
  if (!Number.isFinite(panelWidthPx) || panelWidthPx <= 0 || panelWidthPx > innerWidthPx) {
    throw new RangeError("One complete panel does not fit inside the page inner width.");
  }

  const columnInput = options.page?.columns ?? renderDefaults.document.page.columns;
  const maximumColumns = Math.max(
    1,
    Math.floor((innerWidthPx + pageGapPx) / (panelWidthPx + pageGapPx)),
  );
  let columnsPerPage: number;
  if (columnInput === "auto") {
    columnsPerPage = maximumColumns;
  } else {
    assertPositiveInteger(columnInput, "page.columns");
    columnsPerPage = columnInput;
    const occupiedWidthPx = columnsPerPage * panelWidthPx + (columnsPerPage - 1) * pageGapPx;
    if (!Number.isFinite(occupiedWidthPx) || occupiedWidthPx > innerWidthPx) {
      throw new RangeError("The explicit page column count does not fit inside the page.");
    }
  }

  const maxNoteRows = options.panel?.maxNoteRows ?? renderDefaults.document.panel.maxNoteRows;
  if (maxNoteRows !== "unbounded") assertPositiveInteger(maxNoteRows, "panel.maxNoteRows");
  const maxSourceDurationMs =
    options.panel?.maxSourceDurationMs ?? renderDefaults.document.panel.maxSourceDurationMs;
  assertPositiveFinite(maxSourceDurationMs, "panel.maxSourceDurationMs");

  return {
    range,
    style,
    pageSize,
    pagePaddingPx,
    pageGapPx,
    columnsPerPage,
    panelWidthPx,
    panelContentHeightPx,
    maxNoteRows,
    maxSourceDurationMs,
    timeDirection: options.timeDirection ?? renderDefaults.document.timeDirection,
    timeAxis,
    rowTimes: uniqueNoteStartTimes(chart, range),
  };
}

function resolvePadding(input: RenderPaddingInput | undefined): RenderPadding {
  const defaults = renderDefaults.document.page.paddingPx;
  if (typeof input === "number") {
    assertNonNegativeFinite(input, "page.paddingPx");
    return { top: input, right: input, bottom: input, left: input };
  }
  const padding = input as Partial<RenderPadding> | undefined;
  const resolved = {
    top: padding?.top ?? defaults.top,
    right: padding?.right ?? defaults.right,
    bottom: padding?.bottom ?? defaults.bottom,
    left: padding?.left ?? defaults.left,
  };
  for (const [side, value] of Object.entries(resolved)) {
    assertNonNegativeFinite(value, `page.paddingPx.${side}`);
  }
  return resolved;
}

function resolveTimeAxisOptions(
  input: RenderDocumentOptions["timeAxis"],
): false | ResolvedRenderTimeAxisOptions {
  if (input === false) return false;
  const defaults = renderDefaults.document.timeAxis;
  const widthPx = input?.widthPx ?? defaults.widthPx;
  assertPositiveFinite(widthPx, "timeAxis.widthPx");
  const tickStepMs = input?.tickStepMs ?? defaults.tickStepMs;
  if (tickStepMs !== "auto") assertPositiveFinite(tickStepMs, "timeAxis.tickStepMs");
  return {
    side: input?.side ?? defaults.side,
    widthPx,
    gapPx: defaults.gapPx,
    labels: input?.labels ?? defaults.labels,
    tickStepMs,
    showCompressionMarks: input?.showCompressionMarks ?? defaults.showCompressionMarks,
  };
}

function planLinearPanels(
  layout: DocumentLayout,
  pixelsPerSecond: number,
): readonly PlannedPanel[] {
  const maximumPhysicalDurationMs = (layout.panelContentHeightPx * 1000) / pixelsPerSecond;
  const panels: PlannedPanel[] = [];
  let startMs = layout.range.startMs;

  while (startMs < layout.range.endMs) {
    const endMs = Math.min(
      layout.range.endMs,
      startMs + maximumPhysicalDurationMs,
      startMs + layout.maxSourceDurationMs,
      noteRowBoundary(layout, startMs),
    );
    if (!Number.isFinite(endMs) || endMs <= startMs) {
      throw new RangeError("Document constraints could not produce a non-empty panel range.");
    }
    const range = { startMs, endMs };
    const contentHeightPx = ((endMs - startMs) * pixelsPerSecond) / 1000;
    const projection: LinearRenderTimeProjection = {
      type: "linear",
      range,
      direction: layout.timeDirection,
      pixelsPerSecond,
      contentTopPx: layout.style.metrics.paddingPx.top,
      contentHeightPx,
    };
    panels.push({
      range,
      noteRowCount: countNoteRows(layout.rowTimes, range),
      projection,
    });
    startMs = endMs;
  }

  return panels;
}

function planRowAwarePanels(
  chart: ManiaChart,
  layout: DocumentLayout,
  scale: Extract<ResolvedRenderDocumentScale, { readonly type: "row-aware" }>,
): readonly PlannedPanel[] {
  const panels: PlannedPanel[] = [];
  let startMs = layout.range.startMs;

  while (startMs < layout.range.endMs) {
    const candidateEndMs = Math.min(
      layout.range.endMs,
      startMs + layout.maxSourceDurationMs,
      noteRowBoundary(layout, startMs),
    );
    let resolved = resolvePiecewiseProjection(chart, layout, scale, {
      startMs,
      endMs: candidateEndMs,
    });
    let endMs = candidateEndMs;

    if (resolved.projection.contentHeightPx > layout.panelContentHeightPx) {
      const overflowIndex = resolved.intervals.findIndex(
        (_, index) =>
          (resolved.projection.anchors[index + 1]?.distancePx ?? Number.POSITIVE_INFINITY) >
          layout.panelContentHeightPx,
      );
      const overflow = resolved.intervals[overflowIndex];
      const distanceBeforePx = resolved.projection.anchors[overflowIndex]?.distancePx;
      if (!overflow || distanceBeforePx === undefined) {
        throw new RangeError("Row-aware projection overflow could not be resolved.");
      }

      if (hasNoteStartAt(layout.rowTimes, overflow.endMs)) {
        const prefix = resolvePiecewiseProjection(chart, layout, scale, {
          startMs,
          endMs: overflow.endMs,
        });
        if (prefix.projection.contentHeightPx <= layout.panelContentHeightPx) {
          endMs = overflow.endMs;
          resolved = prefix;
        }
      }

      if (endMs === candidateEndMs) {
        endMs = overflow.capped
          ? overflow.startMs
          : overflow.startMs +
            ((layout.panelContentHeightPx - distanceBeforePx) * 1000) / scale.basePixelsPerSecond;
        resolved = resolvePiecewiseProjection(chart, layout, scale, { startMs, endMs });
        while (
          !overflow.capped &&
          resolved.projection.contentHeightPx > layout.panelContentHeightPx &&
          endMs > startMs
        ) {
          endMs = nextDown(endMs);
          resolved = resolvePiecewiseProjection(chart, layout, scale, { startMs, endMs });
        }
      }
    }

    if (
      !Number.isFinite(endMs) ||
      endMs <= startMs ||
      resolved.projection.contentHeightPx > layout.panelContentHeightPx
    ) {
      throw new RangeError("Document constraints could not produce a fitting row-aware panel.");
    }
    const range = { startMs, endMs };
    panels.push({
      range,
      noteRowCount: countNoteRows(layout.rowTimes, range),
      projection: resolved.projection,
    });
    startMs = endMs;
  }

  return panels;
}

function resolvePiecewiseProjection(
  chart: ManiaChart,
  layout: DocumentLayout,
  scale: Extract<ResolvedRenderDocumentScale, { readonly type: "row-aware" }>,
  range: TimeRange,
): ResolvedPiecewiseProjection {
  const anchorTimes = piecewiseAnchorTimes(chart, range);
  const rowTimes = uniqueNoteStartTimes(chart, range);
  const intervals = anchorTimes.slice(1).map((endMs, index) => {
    const startMs = anchorTimes[index] as number;
    const baselineDistancePx = ((endMs - startMs) * scale.basePixelsPerSecond) / 1000;
    const activeLongNote = chart.notes.some(
      (note) =>
        note.kind === "long" &&
        note.startMs <= startMs &&
        note.endMs >= endMs &&
        note.endMs > startMs,
    );
    return {
      startMs,
      endMs,
      baselineDistancePx,
      distancePx: activeLongNote
        ? baselineDistancePx
        : Math.min(baselineDistancePx, scale.maxEmptyGapPx),
      capped: !activeLongNote && baselineDistancePx > scale.maxEmptyGapPx,
    };
  });
  const mutableDistances = intervals.map((interval) => interval.distancePx);
  const anchorIndex = new Map(anchorTimes.map((timeMs, index) => [timeMs, index]));

  for (let rowIndex = 1; rowIndex < rowTimes.length; rowIndex += 1) {
    const previousAnchorIndex = anchorIndex.get(rowTimes[rowIndex - 1] as number);
    const currentAnchorIndex = anchorIndex.get(rowTimes[rowIndex] as number);
    if (previousAnchorIndex === undefined || currentAnchorIndex === undefined) continue;
    let distancePx = 0;
    for (let index = previousAnchorIndex; index < currentAnchorIndex; index += 1) {
      distancePx += mutableDistances[index] as number;
    }
    if (distancePx < scale.minRowGapPx) {
      mutableDistances[currentAnchorIndex - 1] =
        (mutableDistances[currentAnchorIndex - 1] as number) + scale.minRowGapPx - distancePx;
    }
  }

  const anchors = [{ timeMs: range.startMs, distancePx: 0 }];
  for (let index = 0; index < intervals.length; index += 1) {
    anchors.push({
      timeMs: intervals[index]?.endMs as number,
      distancePx: (anchors[index]?.distancePx as number) + (mutableDistances[index] as number),
    });
  }
  const resolvedIntervals = intervals.map((interval, index) => ({
    ...interval,
    distancePx: mutableDistances[index] as number,
  }));
  const compressedRanges: TimeRange[] = [];
  for (const interval of resolvedIntervals) {
    if (interval.distancePx >= interval.baselineDistancePx) continue;
    const previous = compressedRanges.at(-1);
    if (previous?.endMs === interval.startMs) {
      compressedRanges[compressedRanges.length - 1] = {
        startMs: previous.startMs,
        endMs: interval.endMs,
      };
    } else {
      compressedRanges.push({ startMs: interval.startMs, endMs: interval.endMs });
    }
  }
  const contentHeightPx = anchors.at(-1)?.distancePx as number;
  return {
    projection: {
      type: "piecewise-linear",
      range,
      direction: layout.timeDirection,
      contentTopPx: layout.style.metrics.paddingPx.top,
      contentHeightPx,
      basePixelsPerSecond: scale.basePixelsPerSecond,
      anchors,
      compressedRanges,
    },
    intervals: resolvedIntervals,
  };
}

function piecewiseAnchorTimes(chart: ManiaChart, range: TimeRange): readonly number[] {
  const times = new Set<number>([range.startMs, range.endMs]);
  for (const note of chart.notes) {
    if (note.startMs >= range.startMs && note.startMs < range.endMs) times.add(note.startMs);
    if (note.kind === "long" && note.endMs > range.startMs && note.startMs < range.endMs) {
      times.add(Math.max(note.startMs, range.startMs));
      times.add(Math.min(note.endMs, range.endMs));
    }
  }
  return [...times].sort((left, right) => left - right);
}

function assembleDocument(
  chart: ManiaChart,
  layout: DocumentLayout,
  scale: ResolvedRenderDocumentScale,
  plannedPanels: readonly PlannedPanel[],
  diagnostics: readonly RenderDiagnostic[],
): RenderDocument {
  const panels = plannedPanels.map((planned, index): RenderPanel => {
    const scene = createRenderSceneFromProjection(chart, planned.projection, layout.style);
    const y =
      layout.timeDirection === "top-to-bottom"
        ? layout.pagePaddingPx.top
        : layout.pageSize.heightPx - layout.pagePaddingPx.bottom - scene.size.heightPx;
    const column = index % layout.columnsPerPage;
    const frame = {
      x: layout.pagePaddingPx.left + column * (layout.panelWidthPx + layout.pageGapPx),
      y,
      width: layout.panelWidthPx,
      height: scene.size.heightPx,
    };
    const timeAxis =
      layout.timeAxis === false ? undefined : createTimeAxis(planned.projection, layout.timeAxis);
    return timeAxis
      ? { index, range: planned.range, noteRowCount: planned.noteRowCount, frame, scene, timeAxis }
      : { index, range: planned.range, noteRowCount: planned.noteRowCount, frame, scene };
  });
  const pages = Array.from(
    { length: pageCount(panels.length, layout.columnsPerPage) },
    (_, index) => {
      const pagePanels = panels.slice(
        index * layout.columnsPerPage,
        (index + 1) * layout.columnsPerPage,
      );
      return {
        index,
        size: layout.pageSize,
        range: {
          startMs: pagePanels[0]?.range.startMs as number,
          endMs: pagePanels.at(-1)?.range.endMs as number,
        },
        panels: pagePanels,
      };
    },
  );
  const resolved: ResolvedRenderDocumentOptions = {
    pageSize: layout.pageSize,
    pagePaddingPx: layout.pagePaddingPx,
    pageGapPx: layout.pageGapPx,
    columnsPerPage: layout.columnsPerPage,
    panelPlayfield: layout.style.playfield,
    panelWidthPx: layout.panelWidthPx,
    panelContentHeightPx: layout.panelContentHeightPx,
    maxNoteRows: layout.maxNoteRows,
    maxSourceDurationMs: layout.maxSourceDurationMs,
    scale,
    timeDirection: layout.timeDirection,
    timeAxis: layout.timeAxis,
    panelCount: panels.length,
    pageCount: pages.length,
  };

  return {
    kind: "mania-document",
    range: layout.range,
    pageSize: layout.pageSize,
    resolved,
    pages,
    diagnostics,
  };
}

function createTimeAxis(
  projection: RenderTimeProjection,
  options: ResolvedRenderTimeAxisOptions,
): RenderTimeAxis {
  const tickStepMs =
    options.tickStepMs === "auto" ? resolveAutomaticTickStep(projection) : options.tickStepMs;
  const startTick = {
    kind: "start" as const,
    timeMs: projection.range.startMs,
    y: projectTime(projection, projection.range.startMs),
    label: formatAxisTime(projection.range.startMs),
  };
  const endTick = {
    kind: "end" as const,
    timeMs: projection.range.endMs,
    y: projectTime(projection, projection.range.endMs),
    label: formatAxisTime(projection.range.endMs),
  };
  const majorTicks: RenderTimeAxisTick[] = [];

  if (options.labels === "major") {
    const firstIndex = Math.floor(projection.range.startMs / tickStepMs) + 1;
    const lastIndex = Math.ceil(projection.range.endMs / tickStepMs) - 1;
    let previousY = startTick.y;
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const timeMs = index * tickStepMs;
      if (timeMs <= projection.range.startMs || timeMs >= projection.range.endMs) continue;
      const y = projectTime(projection, timeMs);
      if (
        Math.abs(y - startTick.y) < 18 ||
        Math.abs(y - endTick.y) < 18 ||
        Math.abs(y - previousY) < 18
      ) {
        continue;
      }
      majorTicks.push({ kind: "major", timeMs, y, label: formatAxisTime(timeMs) });
      previousY = y;
    }
  }

  return {
    side: options.side,
    widthPx: options.widthPx,
    gapPx: options.gapPx,
    labels: options.labels,
    tickStepMs,
    ticks: [startTick, ...majorTicks, endTick],
    compressionMarks:
      options.showCompressionMarks && projection.type === "piecewise-linear"
        ? projection.compressedRanges.map((range) => ({
            range,
            y: projectTime(projection, (range.startMs + range.endMs) / 2),
          }))
        : [],
  };
}

function resolveAutomaticTickStep(projection: RenderTimeProjection): number {
  const averageDistanceTargetMs =
    (48 * (projection.range.endMs - projection.range.startMs)) / projection.contentHeightPx;
  const magnitude = 10 ** Math.floor(Math.log10(averageDistanceTargetMs));
  for (const multiplier of [1, 2, 5, 10]) {
    const step = multiplier * magnitude;
    if (step >= averageDistanceTargetMs) return step;
  }
  return 10 * magnitude;
}

function formatAxisTime(timeMs: number): string {
  const totalTenths = Math.round(Math.abs(timeMs) / 100);
  const sign = timeMs < 0 && totalTenths > 0 ? "-" : "";
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`
    : `${sign}${totalMinutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function uniqueNoteStartTimes(chart: ManiaChart, range: TimeRange): readonly number[] {
  return [
    ...new Set(
      chart.notes
        .filter((note) => note.startMs >= range.startMs && note.startMs < range.endMs)
        .map((note) => note.startMs),
    ),
  ].sort((left, right) => left - right);
}

function noteRowBoundary(layout: DocumentLayout, startMs: number): number {
  if (layout.maxNoteRows === "unbounded") return Number.POSITIVE_INFINITY;
  const firstRowIndex = lowerBound(layout.rowTimes, startMs);
  return layout.rowTimes[firstRowIndex + layout.maxNoteRows] ?? Number.POSITIVE_INFINITY;
}

function countNoteRows(rowTimes: readonly number[], range: TimeRange): number {
  return lowerBound(rowTimes, range.endMs) - lowerBound(rowTimes, range.startMs);
}

function hasNoteStartAt(rowTimes: readonly number[], timeMs: number): boolean {
  return rowTimes[lowerBound(rowTimes, timeMs)] === timeMs;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] as number) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nextDown(value: number): number {
  if (value === 0) return -Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + (value > 0 ? -1n : 1n));
  return view.getFloat64(0);
}

function pageCount(panelCount: number, columnsPerPage: number): number {
  return Math.ceil(panelCount / columnsPerPage);
}

function assertPositiveFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive.`);
  }
}

function assertNonNegativeFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative.`);
  }
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}
