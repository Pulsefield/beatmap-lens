import type { PiecewiseLinearRenderTimeProjection, RenderTimeProjection } from "./types.js";

export function projectTime(projection: RenderTimeProjection, timeMs: number): number {
  validateRenderTimeProjection(projection);
  return projectTimeFromValidatedProjection(projection, timeMs);
}

export function projectTimeFromValidatedProjection(
  projection: RenderTimeProjection,
  timeMs: number,
): number {
  if (
    !Number.isFinite(timeMs) ||
    timeMs < projection.range.startMs ||
    timeMs > projection.range.endMs
  ) {
    throw new RangeError("timeMs must be finite and inside the projection range.");
  }

  const contentBottomPx = projection.contentTopPx + projection.contentHeightPx;
  if (timeMs === projection.range.startMs) {
    return projection.direction === "top-to-bottom" ? projection.contentTopPx : contentBottomPx;
  }
  if (timeMs === projection.range.endMs) {
    return projection.direction === "top-to-bottom" ? contentBottomPx : projection.contentTopPx;
  }

  const distancePx =
    projection.type === "linear"
      ? ((timeMs - projection.range.startMs) * projection.pixelsPerSecond) / 1000
      : projectPiecewiseDistance(projection, timeMs);
  return projection.direction === "top-to-bottom"
    ? projection.contentTopPx + distancePx
    : contentBottomPx - distancePx;
}

export function unprojectTime(projection: RenderTimeProjection, yPx: number): number {
  validateRenderTimeProjection(projection);
  const contentBottomPx = projection.contentTopPx + projection.contentHeightPx;
  if (!Number.isFinite(yPx) || yPx < projection.contentTopPx || yPx > contentBottomPx) {
    throw new RangeError("yPx must be finite and inside the projection content bounds.");
  }

  if (yPx === projection.contentTopPx) {
    return projection.direction === "top-to-bottom"
      ? projection.range.startMs
      : projection.range.endMs;
  }
  if (yPx === contentBottomPx) {
    return projection.direction === "top-to-bottom"
      ? projection.range.endMs
      : projection.range.startMs;
  }

  const distancePx =
    projection.direction === "top-to-bottom"
      ? yPx - projection.contentTopPx
      : contentBottomPx - yPx;
  return projection.type === "linear"
    ? projection.range.startMs + (distancePx * 1000) / projection.pixelsPerSecond
    : unprojectPiecewiseDistance(projection, distancePx);
}

function projectPiecewiseDistance(
  projection: PiecewiseLinearRenderTimeProjection,
  timeMs: number,
): number {
  const rightIndex = findRightAnchorIndex(projection, timeMs, "timeMs");
  const left = projection.anchors[rightIndex - 1];
  const right = projection.anchors[rightIndex];
  if (!left || !right) throw new RangeError("Piecewise projection anchors are incomplete.");
  if (timeMs === right.timeMs) return right.distancePx;

  const ratio = (timeMs - left.timeMs) / (right.timeMs - left.timeMs);
  return left.distancePx + ratio * (right.distancePx - left.distancePx);
}

function unprojectPiecewiseDistance(
  projection: PiecewiseLinearRenderTimeProjection,
  distancePx: number,
): number {
  const rightIndex = findRightAnchorIndex(projection, distancePx, "distancePx");
  const left = projection.anchors[rightIndex - 1];
  const right = projection.anchors[rightIndex];
  if (!left || !right) throw new RangeError("Piecewise projection anchors are incomplete.");
  if (distancePx === right.distancePx) return right.timeMs;

  const ratio = (distancePx - left.distancePx) / (right.distancePx - left.distancePx);
  return left.timeMs + ratio * (right.timeMs - left.timeMs);
}

function findRightAnchorIndex(
  projection: PiecewiseLinearRenderTimeProjection,
  value: number,
  coordinate: "timeMs" | "distancePx",
): number {
  let lower = 1;
  let upper = projection.anchors.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (value <= (projection.anchors[middle]?.[coordinate] as number)) upper = middle;
    else lower = middle + 1;
  }
  return lower;
}

export function validateRenderTimeProjection(projection: RenderTimeProjection): void {
  const { startMs, endMs } = projection.range;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    !Number.isFinite(projection.contentTopPx) ||
    !Number.isFinite(projection.contentHeightPx) ||
    projection.contentHeightPx <= 0
  ) {
    throw new RangeError("Render time projection must contain finite, consistent geometry.");
  }

  if (projection.type === "linear") {
    const expectedContentHeightPx = ((endMs - startMs) * projection.pixelsPerSecond) / 1000;
    if (
      !Number.isFinite(projection.pixelsPerSecond) ||
      projection.pixelsPerSecond <= 0 ||
      projection.contentHeightPx !== expectedContentHeightPx
    ) {
      throw new RangeError("Render time projection must contain finite, consistent geometry.");
    }
    return;
  }

  const first = projection.anchors[0];
  const last = projection.anchors.at(-1);
  if (
    !Number.isFinite(projection.basePixelsPerSecond) ||
    projection.basePixelsPerSecond <= 0 ||
    projection.anchors.length < 2 ||
    first?.timeMs !== startMs ||
    first?.distancePx !== 0 ||
    last?.timeMs !== endMs ||
    last?.distancePx !== projection.contentHeightPx
  ) {
    throw new RangeError("Render time projection must contain finite, consistent geometry.");
  }

  for (let index = 0; index < projection.anchors.length; index += 1) {
    const anchor = projection.anchors[index];
    const previous = projection.anchors[index - 1];
    if (
      !anchor ||
      !Number.isFinite(anchor.timeMs) ||
      !Number.isFinite(anchor.distancePx) ||
      (previous !== undefined &&
        (anchor.timeMs <= previous.timeMs || anchor.distancePx <= previous.distancePx))
    ) {
      throw new RangeError("Piecewise projection anchors must be finite and strictly increasing.");
    }
  }
}
