import type { ManiaChart } from "beatmap-lens";
import { chartEndMs } from "./range";

export const overviewDensityResolution = 256;

export type OverviewDensityOrientation = "horizontal" | "vertical";

export interface OverviewDensityOptions {
  readonly width: number;
  readonly height: number;
  readonly orientation?: OverviewDensityOrientation;
  readonly resolution?: number;
  readonly startMs?: number;
  readonly endMs?: number;
}

export interface OverviewDensityPath {
  readonly path: string;
  readonly counts: readonly number[];
  readonly maxCount: number;
  readonly resolution: number;
  readonly orientation: OverviewDensityOrientation;
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
  const orientation = options.orientation ?? "horizontal";
  if (endMs <= startMs) {
    throw new RangeError("Density endMs must be greater than startMs.");
  }

  const counts = Array.from({ length: resolution }, () => 0);
  const durationMs = endMs - startMs;
  for (const note of chart.notes) {
    if (note.startMs < startMs || note.startMs >= endMs) {
      continue;
    }
    const bin = Math.min(
      Math.floor(((note.startMs - startMs) / durationMs) * resolution),
      resolution - 1,
    );
    counts[bin] = (counts[bin] ?? 0) + 1;
  }

  const maxCount = Math.max(0, ...counts);
  const path =
    orientation === "vertical"
      ? createVerticalDensityPath(counts, maxCount, options.width, options.height)
      : createHorizontalDensityPath(counts, maxCount, options.width, options.height);

  return {
    path,
    counts,
    maxCount,
    resolution,
    orientation,
    startMs,
    endMs,
    binDurationMs: durationMs / resolution,
  };
}

function createHorizontalDensityPath(
  counts: readonly number[],
  maxCount: number,
  width: number,
  height: number,
): string {
  const points = counts.map((count, index) => {
    const x = (index / (counts.length - 1)) * width;
    const y = maxCount === 0 ? height : height * (1 - count / maxCount);
    return `${round3(x)} ${round3(y)}`;
  });
  return `M 0 ${round3(height)} L ${points.join(" L ")} L ${round3(width)} ${round3(height)} Z`;
}

function createVerticalDensityPath(
  counts: readonly number[],
  maxCount: number,
  width: number,
  height: number,
): string {
  const points = counts.map((count, index) => {
    const x = maxCount === 0 ? 0 : width * (count / maxCount);
    const y = height * (1 - index / (counts.length - 1));
    return `${round3(x)} ${round3(y)}`;
  });
  return `M 0 ${round3(height)} L ${points.join(" L ")} L 0 0 Z`;
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
