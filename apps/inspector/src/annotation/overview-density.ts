import type { ManiaChart } from "beatmap-lens";
import { chartEndMs } from "./range";

export const overviewDensityResolution = 256;

export interface OverviewDensityOptions {
  readonly width: number;
  readonly height: number;
  readonly resolution?: number;
  readonly startMs?: number;
  readonly endMs?: number;
}

export interface OverviewDensityPath {
  readonly path: string;
  readonly counts: readonly number[];
  readonly maxCount: number;
  readonly resolution: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly binDurationMs: number;
}

/** Builds one fixed-size onset histogram and SVG area path, regardless of chart note count. */
export function createOverviewDensityPath(
  chart: ManiaChart,
  options: OverviewDensityOptions,
): OverviewDensityPath {
  const resolution = options.resolution ?? overviewDensityResolution;
  if (!Number.isInteger(resolution) || resolution < 2) {
    throw new RangeError("Density resolution must be an integer of at least 2.");
  }

  const startMs = options.startMs ?? 0;
  const endMs = options.endMs ?? chartEndMs(chart);
  if (endMs <= startMs) {
    throw new RangeError("Density endMs must be greater than startMs.");
  }

  const counts = Array.from({ length: resolution }, () => 0);
  const durationMs = endMs - startMs;
  for (const note of chart.notes) {
    if (note.startTime < startMs || note.startTime >= endMs) {
      continue;
    }
    const bin = Math.min(
      Math.floor(((note.startTime - startMs) / durationMs) * resolution),
      resolution - 1,
    );
    counts[bin] = (counts[bin] ?? 0) + 1;
  }

  const maxCount = Math.max(0, ...counts);
  const points = counts.map((count, index) => {
    const x = (index / (resolution - 1)) * options.width;
    const y = maxCount === 0 ? options.height : options.height * (1 - count / maxCount);
    return `${round3(x)} ${round3(y)}`;
  });
  const path = `M 0 ${round3(options.height)} L ${points.join(" L ")} L ${round3(
    options.width,
  )} ${round3(options.height)} Z`;

  return {
    path,
    counts,
    maxCount,
    resolution,
    startMs,
    endMs,
    binDurationMs: durationMs / resolution,
  };
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
