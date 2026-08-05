export const viewportAutoScrollEdgeZonePx = 40;

export type ViewportAutoScrollEdge = "top" | "bottom";

export interface ViewportClientRect {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

export interface ViewportPointerYOptions {
  readonly clientY: number;
  readonly rect: ViewportClientRect;
  readonly viewportHeight: number;
}

export interface ViewportPointerY {
  readonly clampedClientY: number;
  readonly viewportY: number;
}

export interface ViewportEdgePenetrationOptions {
  readonly clientY: number;
  readonly rect: ViewportClientRect;
  readonly edgeZonePx?: number;
}

export interface ViewportEdgePenetration {
  readonly edge: ViewportAutoScrollEdge;
  readonly penetrationPx: number;
  readonly penetrationRatio: number;
}

export interface ViewportAutoScrollAdvanceOptions {
  readonly playheadMs: number;
  readonly elapsedMs: number;
  readonly chartEndMs: number;
  readonly viewportDurationMs: number;
  readonly penetration: ViewportEdgePenetration | undefined;
}

export interface ViewportAutoScrollAdvance {
  readonly playheadMs: number;
  readonly deltaMs: number;
  readonly velocityMsPerSecond: number;
}

export function viewportPointerY(options: ViewportPointerYOptions): ViewportPointerY {
  const clampedClientY = clamp(options.clientY, options.rect.top, options.rect.bottom);
  return {
    clampedClientY,
    viewportY: ((clampedClientY - options.rect.top) / options.rect.height) * options.viewportHeight,
  };
}

export function viewportEdgePenetration(
  options: ViewportEdgePenetrationOptions,
): ViewportEdgePenetration | undefined {
  const edgeZonePx = options.edgeZonePx ?? viewportAutoScrollEdgeZonePx;
  const topPenetrationPx = clamp(edgeZonePx - (options.clientY - options.rect.top), 0, edgeZonePx);
  const bottomPenetrationPx = clamp(
    edgeZonePx - (options.rect.bottom - options.clientY),
    0,
    edgeZonePx,
  );
  const penetrationPx = Math.max(topPenetrationPx, bottomPenetrationPx);

  if (penetrationPx === 0) return undefined;

  return {
    edge: topPenetrationPx >= bottomPenetrationPx ? "top" : "bottom",
    penetrationPx,
    penetrationRatio: penetrationPx / edgeZonePx,
  };
}

export function viewportAutoScrollVelocityMsPerSecond(
  penetration: ViewportEdgePenetration | undefined,
  viewportDurationMs: number,
): number {
  if (!penetration) return 0;

  const direction = penetration.edge === "top" ? 1 : -1;
  return direction * penetration.penetrationRatio ** 2 * viewportDurationMs;
}

export function advanceViewportAutoScroll(
  options: ViewportAutoScrollAdvanceOptions,
): ViewportAutoScrollAdvance {
  const velocityMsPerSecond = viewportAutoScrollVelocityMsPerSecond(
    options.penetration,
    options.viewportDurationMs,
  );
  const targetPlayheadMs = options.playheadMs + (velocityMsPerSecond * options.elapsedMs) / 1_000;
  const playheadMs = clamp(targetPlayheadMs, 0, options.chartEndMs);

  return {
    playheadMs,
    deltaMs: playheadMs - options.playheadMs,
    velocityMsPerSecond,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
