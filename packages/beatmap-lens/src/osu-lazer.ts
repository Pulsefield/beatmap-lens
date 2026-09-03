import type { OsuLazerManiaPixelsPerSecondOptions } from "./types.js";

const referenceViewport = { widthPx: 1024, heightPx: 768 } as const;
const maximumTimeRangeMs = 11_485;
const stableScale = 1.6;
const defaultHitPositionPx = (480 - 402) * stableScale;
const defaultTravelDistancePx = referenceViewport.heightPx - defaultHitPositionPx;

/**
 * Converts osu!lazer's mania scroll speed to a baseline linear speed for its standard landscape
 * playfield. The effective gameplay viewport and result use the same pixel coordinate space.
 *
 * This models a 1x scrolling multiplier without rate mods. Beatmap timing and SV changes require
 * a time-varying projection rather than one `pixelsPerSecond` value.
 */
export function osuLazerManiaPixelsPerSecond(options: OsuLazerManiaPixelsPerSecondOptions): number {
  const { gameplayViewport, scrollSpeed } = options;
  assertFiniteRange(scrollSpeed, 1, 40, "scrollSpeed");
  assertPositiveFinite(gameplayViewport.widthPx, "gameplayViewport.widthPx");
  assertPositiveFinite(gameplayViewport.heightPx, "gameplayViewport.heightPx");

  if (gameplayViewport.widthPx < gameplayViewport.heightPx) {
    throw new RangeError("gameplayViewport must use osu!lazer's standard landscape layout.");
  }

  const viewportScale = Math.min(
    gameplayViewport.widthPx / referenceViewport.widthPx,
    gameplayViewport.heightPx / referenceViewport.heightPx,
  );

  return (defaultTravelDistancePx * scrollSpeed * viewportScale * 1_000) / maximumTimeRangeMs;
}

function assertFiniteRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive.`);
  }
}
