import type { ManiaChart, ManiaNote } from "beatmap-lens";
import type { StableNoteRefV1 } from "./contracts";

export type StableNoteRefIndexV1 = ReadonlyMap<string, ManiaNote>;

export function createStableNoteRefV1(note: ManiaNote): StableNoteRefV1 {
  return {
    sourceLine: note.sourceLine,
    column: note.column,
    kind: note.kind,
    startMs: note.startMs,
    endMs: note.endMs,
  };
}

export function createStableNoteRefsV1(
  chartOrNotes: Pick<ManiaChart, "notes"> | readonly ManiaNote[],
): readonly StableNoteRefV1[] {
  return notesFrom(chartOrNotes).map(createStableNoteRefV1);
}

export function createStableNoteRefIndexV1(
  chartOrNotes: Pick<ManiaChart, "notes"> | readonly ManiaNote[],
): StableNoteRefIndexV1 {
  return new Map(
    notesFrom(chartOrNotes).map((note) => [stableNoteRefKey(createStableNoteRefV1(note)), note]),
  );
}

export function resolveStableNoteRefV1(
  index: StableNoteRefIndexV1,
  ref: StableNoteRefV1,
): ManiaNote {
  const note = index.get(stableNoteRefKey(ref));
  if (!note) {
    throw new Error(`Stable note reference at source line ${ref.sourceLine} does not resolve`);
  }
  return note;
}

export function resolveStableNoteRefsV1(
  index: StableNoteRefIndexV1,
  refs: readonly StableNoteRefV1[],
): readonly ManiaNote[] {
  return refs.map((ref) => resolveStableNoteRefV1(index, ref));
}

export const createStableNoteRef = createStableNoteRefV1;
export const createStableNoteRefs = createStableNoteRefsV1;
export const resolveStableNoteRef = resolveStableNoteRefV1;
export const resolveStableNoteRefs = resolveStableNoteRefsV1;

export function stableNoteRefKey(ref: StableNoteRefV1): string {
  return [ref.sourceLine, ref.column, ref.kind, ref.startMs, ref.endMs].join(":");
}

export function stableNoteRefMatchesNote(ref: StableNoteRefV1, note: ManiaNote): boolean {
  return (
    ref.sourceLine === note.sourceLine &&
    ref.column === note.column &&
    ref.kind === note.kind &&
    ref.startMs === note.startMs &&
    ref.endMs === note.endMs
  );
}

function notesFrom(
  chartOrNotes: Pick<ManiaChart, "notes"> | readonly ManiaNote[],
): readonly ManiaNote[] {
  return "notes" in chartOrNotes ? chartOrNotes.notes : chartOrNotes;
}
