import { osuLazerManiaPixelsPerSecond } from "./osu-lazer.js";
import { renderDefaults } from "./render-defaults.js";
import { createRenderSceneFromProjection, resolveRenderSceneStyle } from "./render-scene.js";
import type {
  ManiaChart,
  RenderAnimation,
  RenderAnimationFrame,
  RenderAnimationOptions,
  RenderScene,
} from "./types.js";

/** Resolve an animation without rendering or retaining any frames. */
export function createRenderAnimation(
  chart: ManiaChart,
  options: RenderAnimationOptions,
): RenderAnimation {
  const { startMs, endMs } = options.range;
  const durationMs = endMs - startMs;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw new RangeError("range.endMs must be finite and greater than range.startMs.");
  }
  const viewport = { ...(options.viewport ?? renderDefaults.animation.viewport) };
  const fps = options.fps ?? renderDefaults.animation.fps;
  for (const [name, value] of Object.entries({
    "viewport.widthPx": viewport.widthPx,
    "viewport.heightPx": viewport.heightPx,
    fps,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be finite and positive.`);
    }
  }
  if (options.scrollSpeed !== undefined && options.pixelsPerSecond !== undefined) {
    throw new RangeError("Choose scrollSpeed or pixelsPerSecond, not both.");
  }
  const pixelsPerSecond =
    options.pixelsPerSecond ??
    osuLazerManiaPixelsPerSecond({
      scrollSpeed: options.scrollSpeed ?? renderDefaults.animation.scrollSpeed,
      gameplayViewport: viewport,
    });
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
    throw new RangeError("pixelsPerSecond must be finite and positive.");
  }
  const style = resolveRenderSceneStyle(chart, { widthPx: viewport.widthPx }, options.theme);
  const contentHeightPx =
    viewport.heightPx - style.metrics.paddingPx.top - style.metrics.paddingPx.bottom;
  if (contentHeightPx <= 0) {
    throw new RangeError("viewport.heightPx must exceed the vertical padding.");
  }
  const visibleDurationMs = (contentHeightPx / pixelsPerSecond) * 1000;
  let frameCount = Math.ceil((durationMs * fps) / 1000);
  // A mathematically integral count can round just above the integer (e.g. 1000 / 30 ms).
  // Use the same source timestamp arithmetic as sampling to exclude an end-boundary frame.
  if (startMs + ((frameCount - 1) * 1000) / fps >= endMs) frameCount--;
  if (
    !Number.isFinite(visibleDurationMs) ||
    visibleDurationMs <= 0 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount <= 0
  ) {
    throw new RangeError("Resolved visible duration and frame count must be finite and positive.");
  }
  return {
    kind: "mania-animation",
    chart,
    range: { startMs, endMs },
    resolved: {
      viewport,
      fps,
      pixelsPerSecond,
      timeDirection: options.timeDirection ?? renderDefaults.scene.timeDirection,
      ...style,
      contentHeightPx,
      visibleDurationMs,
      durationMs,
      frameCount,
    },
  };
}

/** Sample any source time in the animation, independently of its export frame rate. */
export function createAnimationScene(animation: RenderAnimation, timeMs: number): RenderScene {
  if (
    !Number.isFinite(timeMs) ||
    timeMs < animation.range.startMs ||
    timeMs >= animation.range.endMs
  ) {
    throw new RangeError("timeMs must be inside the half-open animation range.");
  }
  const resolved = animation.resolved;
  return createRenderSceneFromProjection(
    animation.chart,
    {
      type: "linear",
      range: { startMs: timeMs, endMs: timeMs + resolved.visibleDurationMs },
      direction: resolved.timeDirection,
      pixelsPerSecond: resolved.pixelsPerSecond,
      contentTopPx: resolved.metrics.paddingPx.top,
      contentHeightPx: resolved.contentHeightPx,
    },
    resolved,
  );
}

/** Lazily sample [startMs, endMs), shortening the last frame to the remaining duration. */
export function* iterateAnimationFrames(
  animation: RenderAnimation,
): Generator<RenderAnimationFrame> {
  const { fps, frameCount } = animation.resolved;
  for (let index = 0; index < frameCount; index++) {
    // Derive each timestamp from the index, avoiding accumulated floating-point drift.
    const timeMs = animation.range.startMs + (index * 1000) / fps;
    const nextTimeMs = animation.range.startMs + ((index + 1) * 1000) / fps;
    yield {
      index,
      timeMs,
      durationMs: Math.min(nextTimeMs, animation.range.endMs) - timeMs,
      scene: createAnimationScene(animation, timeMs),
    };
  }
}
