import type { ManiaNote } from "beatmap-lens";
import type { TimeRangeV1 } from "./contracts";
import { expandRangeToIncludeNote, noteIntersectsRange, rangeCandidates } from "./range";

export interface NoteSelection {
  readonly range: TimeRangeV1;
  readonly candidates: readonly ManiaNote[];
  readonly selectedNotes: readonly ManiaNote[];
  readonly manualExclusions: ReadonlySet<string>;
}

export function createNoteSelection(
  notes: readonly ManiaNote[],
  range: TimeRangeV1,
  manualExclusions: ReadonlySet<string> = new Set(),
): NoteSelection {
  const candidates = rangeCandidates(notes, range);
  const candidateIds = new Set(candidates.map((note) => note.id));
  const applicableExclusions = new Set(
    [...manualExclusions].filter((noteId) => candidateIds.has(noteId)),
  );
  return {
    range,
    candidates,
    selectedNotes: candidates.filter((note) => !applicableExclusions.has(note.id)),
    manualExclusions: applicableExclusions,
  };
}

/** Recomputes candidates and retains only explicit exclusions that still intersect the new range. */
export function changeNoteSelectionRange(
  notes: readonly ManiaNote[],
  selection: NoteSelection,
  range: TimeRangeV1,
): NoteSelection {
  return createNoteSelection(notes, range, selection.manualExclusions);
}

/**
 * Toggles an intersecting candidate. Toggling a note outside the range first expands the range so
 * persisted selections can never contain non-intersecting notes.
 */
export function toggleSelectedNote(
  notes: readonly ManiaNote[],
  selection: NoteSelection,
  note: ManiaNote,
): NoteSelection {
  const range = noteIntersectsRange(note, selection.range)
    ? selection.range
    : expandRangeToIncludeNote(selection.range, note);
  const exclusions = new Set(selection.manualExclusions);

  if (!noteIntersectsRange(note, selection.range) || exclusions.has(note.id)) {
    exclusions.delete(note.id);
  } else {
    exclusions.add(note.id);
  }
  return createNoteSelection(notes, range, exclusions);
}
