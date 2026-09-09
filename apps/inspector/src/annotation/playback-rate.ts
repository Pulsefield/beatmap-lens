/** Judgment speed; all persisted ranges and note references stay in exact source milliseconds. */
export const SUPPORTED_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

export type PlaybackRate = (typeof SUPPORTED_PLAYBACK_RATES)[number];

/** Missing rates are historical 1x judgments; resolving never changes the stored claim. */
export function resolvePlaybackRate(value?: number): PlaybackRate {
  const rate = value === undefined ? 1 : value;
  if (!SUPPORTED_PLAYBACK_RATES.includes(rate as PlaybackRate))
    throw new TypeError(
      `Unsupported playback rate ${String(value)}; expected 0.5, 0.75, 1, 1.25, or 1.5.`,
    );
  return rate as PlaybackRate;
}
