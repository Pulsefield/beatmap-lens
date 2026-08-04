import type { TimeRangeV1 } from "./contracts";
import type { ManiaNoteTimeIndex } from "./note-time-index";

export interface TimelinePlacementOptions {
  readonly chartEndMs: number;
  readonly freePlacement?: boolean;
}

export type TimelineRangeEdge = "start" | "end";

export interface ManualRangeDraft {
  readonly start: string;
  readonly end: string;
}

export interface ManualRangeErrors {
  readonly start?: string;
  readonly end?: string;
  readonly range?: string;
}

export type TimeInputResult =
  | { readonly ok: true; readonly valueMs: number }
  | { readonly ok: false; readonly error: string };

export type ManualRangeResult =
  | {
      readonly ok: true;
      readonly draft: ManualRangeDraft;
      readonly range: TimeRangeV1;
      readonly errors: ManualRangeErrors;
    }
  | {
      readonly ok: false;
      readonly draft: ManualRangeDraft;
      readonly errors: ManualRangeErrors;
    };

export function snapTimelineTime(
  timeMs: number,
  index: ManiaNoteTimeIndex,
  options: TimelinePlacementOptions,
): number {
  const boundedTime = clamp(timeMs, 0, options.chartEndMs);
  if (options.freePlacement) {
    return boundedTime;
  }
  return clamp(index.nearestSnapPoint(boundedTime) ?? boundedTime, 0, options.chartEndMs);
}

export function createTimelineRange(
  anchorMs: number,
  focusMs: number,
  index: ManiaNoteTimeIndex,
  options: TimelinePlacementOptions,
): TimeRangeV1 | undefined {
  const anchor = snapTimelineTime(anchorMs, index, options);
  const focus = snapTimelineTime(focusMs, index, options);
  const startMs = Math.min(anchor, focus);
  const endMs = Math.max(anchor, focus);
  return startMs < endMs ? { startMs, endMs } : undefined;
}

export function moveTimelineRange(
  range: TimeRangeV1,
  deltaMs: number,
  index: ManiaNoteTimeIndex,
  options: TimelinePlacementOptions,
): TimeRangeV1 {
  const durationMs = range.endMs - range.startMs;
  const maximumStart = options.chartEndMs - durationMs;
  const proposedStart = clamp(range.startMs + deltaMs, 0, maximumStart);
  if (options.freePlacement) {
    return { startMs: proposedStart, endMs: proposedStart + durationMs };
  }

  const proposedEnd = proposedStart + durationMs;
  const startSnap = index.nearestSnapPoint(proposedStart);
  const endSnap = index.nearestSnapPoint(proposedEnd);
  const snapDeltas = [
    startSnap === undefined ? undefined : startSnap - proposedStart,
    endSnap === undefined ? undefined : endSnap - proposedEnd,
  ].filter((value): value is number => value !== undefined);
  const snappedDelta = snapDeltas
    .filter((value) => proposedStart + value >= 0 && proposedEnd + value <= options.chartEndMs)
    .sort((left, right) => Math.abs(left) - Math.abs(right))[0];
  const startMs = proposedStart + (snappedDelta ?? 0);
  return { startMs, endMs: startMs + durationMs };
}

export function resizeTimelineRange(
  range: TimeRangeV1,
  edge: TimelineRangeEdge,
  targetMs: number,
  index: ManiaNoteTimeIndex,
  options: TimelinePlacementOptions,
): TimeRangeV1 | undefined {
  const placedTime = snapTimelineTime(targetMs, index, options);
  const resized =
    edge === "start"
      ? { startMs: placedTime, endMs: range.endMs }
      : { startMs: range.startMs, endMs: placedTime };
  return resized.startMs < resized.endMs ? resized : undefined;
}

export function parseTimeInput(input: string): TimeInputResult {
  const value = input.trim();
  const clockMatch = /^(\d+):([0-5]\d)\.(\d{3})$/.exec(value);
  if (clockMatch) {
    const minutes = Number(clockMatch[1]);
    const seconds = Number(clockMatch[2]);
    const milliseconds = Number(clockMatch[3]);
    return { ok: true, valueMs: minutes * 60_000 + seconds * 1_000 + milliseconds };
  }

  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    const valueMs = Number(value);
    if (Number.isFinite(valueMs)) {
      return { ok: true, valueMs };
    }
  }

  return {
    ok: false,
    error: "Use milliseconds or mm:ss.mmm.",
  };
}

export function parseManualRangeDraft(
  draft: ManualRangeDraft,
  chartEndMs: number,
): ManualRangeResult {
  const start = parseTimeInput(draft.start);
  const end = parseTimeInput(draft.end);
  const errors: { start?: string; end?: string; range?: string } = {};

  if (!start.ok) {
    errors.start = start.error;
  } else if (start.valueMs > chartEndMs) {
    errors.start = `Start must be at most ${chartEndMs} ms.`;
  }
  if (!end.ok) {
    errors.end = end.error;
  } else if (end.valueMs > chartEndMs) {
    errors.end = `End must be at most ${chartEndMs} ms.`;
  }

  if (start.ok && end.ok && start.valueMs >= end.valueMs) {
    errors.range = "End must be greater than start.";
  }
  if (Object.keys(errors).length > 0 || !start.ok || !end.ok) {
    return { ok: false, draft, errors };
  }
  return {
    ok: true,
    draft,
    range: { startMs: start.valueMs, endMs: end.valueMs },
    errors,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
