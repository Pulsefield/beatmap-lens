import type { RenderTimeProjection } from "./types.js";

export function projectTime(projection: RenderTimeProjection, timeMs: number): number {
  validateProjection(projection);
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

  const distancePx = ((timeMs - projection.range.startMs) * projection.pixelsPerSecond) / 1000;
  return projection.direction === "top-to-bottom"
    ? projection.contentTopPx + distancePx
    : contentBottomPx - distancePx;
}

export function unprojectTime(projection: RenderTimeProjection, yPx: number): number {
  validateProjection(projection);
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
  return projection.range.startMs + (distancePx * 1000) / projection.pixelsPerSecond;
}

function validateProjection(projection: RenderTimeProjection): void {
  const { startMs, endMs } = projection.range;
  const expectedContentHeightPx = ((endMs - startMs) * projection.pixelsPerSecond) / 1000;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    !Number.isFinite(projection.pixelsPerSecond) ||
    projection.pixelsPerSecond <= 0 ||
    !Number.isFinite(projection.contentTopPx) ||
    !Number.isFinite(projection.contentHeightPx) ||
    projection.contentHeightPx !== expectedContentHeightPx
  ) {
    throw new RangeError("Render time projection must contain finite, consistent geometry.");
  }
}
