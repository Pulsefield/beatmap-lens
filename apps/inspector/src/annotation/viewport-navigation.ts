export const viewportArrowStepPx = 40;

export interface ViewportNavigationOptions {
  readonly chartEndMs: number;
  readonly deltaPixels: number;
  readonly timeMs: number;
  readonly visualSpeed: number;
}

export function navigateViewportTime(options: ViewportNavigationOptions): number {
  const deltaMs = (-options.deltaPixels / options.visualSpeed) * 1_000;
  return Math.min(Math.max(0, options.timeMs + deltaMs), options.chartEndMs);
}

export function wheelDeltaPixels(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * viewportHeight;
  return deltaY;
}
