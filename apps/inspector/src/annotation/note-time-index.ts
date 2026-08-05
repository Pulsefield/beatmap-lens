import type { ManiaNote } from "beatmap-lens";
import type { TimeRangeV1 } from "./contracts";

/**
 * Inspector-private indexes used by viewport and timeline controllers. Runtime note IDs stay here
 * and are never part of the persisted annotation contract.
 */
export class ManiaNoteTimeIndex {
  readonly notes: readonly ManiaNote[];
  readonly snapPoints: readonly number[];

  private readonly longNotes: readonly ManiaNote[];
  private readonly longNoteMaxEnds: readonly number[];

  constructor(notes: readonly ManiaNote[]) {
    this.notes = [...notes].sort(compareNotes);
    this.longNotes = this.notes.filter((note) => note.kind === "long");
    this.longNoteMaxEnds = prefixMax(this.longNotes.map((note) => note.endTime));
    this.snapPoints = uniqueSorted([
      ...this.notes.map((note) => note.startTime),
      ...this.longNotes.map((note) => note.endTime),
    ]);
  }

  /** Returns normal-note onsets and every long note overlapping the half-open range. */
  notesInRange(range: TimeRangeV1): readonly ManiaNote[] {
    const onsetStart = lowerBound(this.notes, range.startMs, (note) => note.startTime);
    const onsetEnd = lowerBound(this.notes, range.endMs, (note) => note.startTime);
    const result = this.notes.slice(onsetStart, onsetEnd);

    const earlierLongEnd = lowerBound(this.longNotes, range.startMs, (note) => note.startTime);
    const firstPossibleLong = upperBound(this.longNoteMaxEnds, range.startMs, (value) => value);

    for (let index = firstPossibleLong; index < earlierLongEnd; index += 1) {
      const note = this.longNotes[index];
      if (note?.endTime !== undefined && note.endTime > range.startMs) {
        result.push(note);
      }
    }

    return result.sort(compareNotes);
  }

  nearestSnapPoint(timeMs: number): number | undefined {
    if (this.snapPoints.length === 0) {
      return undefined;
    }

    const nextIndex = lowerBound(this.snapPoints, timeMs, (value) => value);
    const previous = this.snapPoints[nextIndex - 1];
    const next = this.snapPoints[nextIndex];
    if (previous === undefined) {
      return next;
    }
    if (next === undefined) {
      return previous;
    }
    return timeMs - previous <= next - timeMs ? previous : next;
  }
}

function compareNotes(left: ManiaNote, right: ManiaNote): number {
  return (
    left.startTime - right.startTime ||
    left.endTime - right.endTime ||
    left.column - right.column ||
    left.id.localeCompare(right.id)
  );
}

function prefixMax(values: readonly number[]): readonly number[] {
  let maximum = Number.NEGATIVE_INFINITY;
  return values.map((value) => {
    maximum = Math.max(maximum, value);
    return maximum;
  });
}

function uniqueSorted(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function lowerBound<T>(values: readonly T[], target: number, select: (value: T) => number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (select(values[middle] as T) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBound<T>(values: readonly T[], target: number, select: (value: T) => number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (select(values[middle] as T) <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
