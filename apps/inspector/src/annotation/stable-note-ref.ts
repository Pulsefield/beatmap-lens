import type { ManiaChart, ManiaNote } from "beatmap-lens";
import { type Sha256DigestFunction, sha256Hex } from "./canonical-json";
import type { StableNoteRefV1 } from "./contracts";

export async function createStableNoteRefV1(
  sourceBytes: Uint8Array,
  note: ManiaNote,
  digest?: Sha256DigestFunction,
): Promise<StableNoteRefV1> {
  const objectBytes = sourceLineBytes(sourceBytes, note.sourceLine);
  return {
    sourceLine: note.sourceLine,
    objectSha256: await sha256Hex(objectBytes, digest),
    column: note.column,
    kind: note.kind,
    startMs: note.startTime,
    endMs: note.endTime,
  };
}

export async function createStableNoteRefsV1(
  sourceBytes: Uint8Array,
  chartOrNotes: Pick<ManiaChart, "notes"> | readonly ManiaNote[],
  digest?: Sha256DigestFunction,
): Promise<readonly StableNoteRefV1[]> {
  const notes: readonly ManiaNote[] = Array.isArray(chartOrNotes)
    ? chartOrNotes
    : (chartOrNotes as Pick<ManiaChart, "notes">).notes;
  return Promise.all(notes.map((note) => createStableNoteRefV1(sourceBytes, note, digest)));
}

export async function resolveStableNoteRefV1(
  sourceBytes: Uint8Array,
  chart: Pick<ManiaChart, "notes">,
  ref: StableNoteRefV1,
  sourceSha256: string,
  digest?: Sha256DigestFunction,
): Promise<ManiaNote> {
  await assertSourceHash(sourceBytes, sourceSha256, digest);
  return resolveNoteInVerifiedSource(sourceBytes, chart.notes, ref, digest);
}

export async function resolveStableNoteRefsV1(
  sourceBytes: Uint8Array,
  chart: Pick<ManiaChart, "notes">,
  refs: readonly StableNoteRefV1[],
  sourceSha256: string,
  digest?: Sha256DigestFunction,
): Promise<readonly ManiaNote[]> {
  await assertSourceHash(sourceBytes, sourceSha256, digest);
  return Promise.all(
    refs.map((ref) => resolveNoteInVerifiedSource(sourceBytes, chart.notes, ref, digest)),
  );
}

export const createStableNoteRef = createStableNoteRefV1;
export const createStableNoteRefs = createStableNoteRefsV1;
export const resolveStableNoteRef = resolveStableNoteRefV1;
export const resolveStableNoteRefs = resolveStableNoteRefsV1;

export function stableNoteRefKey(ref: StableNoteRefV1): string {
  return [ref.sourceLine, ref.objectSha256, ref.column, ref.kind, ref.startMs, ref.endMs].join(":");
}

export function stableNoteRefMatchesNote(ref: StableNoteRefV1, note: ManiaNote): boolean {
  return (
    ref.sourceLine === note.sourceLine &&
    ref.column === note.column &&
    ref.kind === note.kind &&
    ref.startMs === note.startTime &&
    ref.endMs === note.endTime
  );
}

export function sourceLineBytes(sourceBytes: Uint8Array, sourceLine: number): Uint8Array {
  if (!Number.isInteger(sourceLine) || sourceLine < 1) {
    throw new Error(`Invalid .osu source line ${sourceLine}`);
  }

  const lines = splitSourceBytes(sourceBytes);
  const line = lines[sourceLine - 1];
  if (!line) throw new Error(`The .osu source does not contain line ${sourceLine}`);
  return line;
}

async function resolveNoteInVerifiedSource(
  sourceBytes: Uint8Array,
  notes: readonly ManiaNote[],
  ref: StableNoteRefV1,
  digest?: Sha256DigestFunction,
): Promise<ManiaNote> {
  const objectSha256 = await sha256Hex(sourceLineBytes(sourceBytes, ref.sourceLine), digest);
  if (objectSha256 !== ref.objectSha256) {
    throw new Error(
      `HitObject line ${ref.sourceLine} SHA-256 mismatch: expected ${ref.objectSha256}, received ${objectSha256}`,
    );
  }

  const note = notes.find((candidate) => stableNoteRefMatchesNote(ref, candidate));
  if (!note) {
    throw new Error(`Stable note reference at source line ${ref.sourceLine} does not resolve`);
  }
  return note;
}

async function assertSourceHash(
  sourceBytes: Uint8Array,
  expectedSha256: string,
  digest?: Sha256DigestFunction,
): Promise<void> {
  const actualSha256 = await sha256Hex(sourceBytes, digest);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Stable note source SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`,
    );
  }
}

function splitSourceBytes(sourceBytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;

  for (let index = 0; index < sourceBytes.length; index += 1) {
    const byte = sourceBytes[index];
    if (byte !== 0x0a && byte !== 0x0d) continue;

    lines.push(sourceBytes.slice(start, index));
    if (byte === 0x0d && sourceBytes[index + 1] === 0x0a) index += 1;
    start = index + 1;
  }

  if (start < sourceBytes.length) lines.push(sourceBytes.slice(start));
  return lines;
}
