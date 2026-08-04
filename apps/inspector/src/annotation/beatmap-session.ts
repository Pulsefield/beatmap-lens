import type { ManiaChart, ManiaNote, ParsedOsu } from "beatmap-lens";
import {
  type CatalogSource,
  type CatalogTask,
  type ReadableDirectoryHandle,
  readCatalogTask,
} from "./catalog";
import {
  ANNOTATION_CONTRACT,
  type AnnotationDocumentV1,
  type FoundationRefV1,
  type GoldAnnotationV1,
  type GoldExemplarRoleV1,
  type JudgmentFoundationV1,
  type SourceIdentityV1,
  type StableNoteRefV1,
} from "./contracts";
import type { DatasetDirectory, StoredAnnotation } from "./dataset-directory";
import { assertActiveFoundationTagV1, canonicalCatalogTagSeedsV1 } from "./foundation";
import { chartEndMs } from "./range";
import type { AnnotationDraft, DraftBaseVersion, SessionStore } from "./session-store";
import { inspectOsuSourceV1 } from "./source-identity";
import {
  createStableNoteRefIndexV1,
  createStableNoteRefsV1,
  type StableNoteRefIndexV1,
  stableNoteRefKey,
} from "./stable-note-ref";
import { assertAnnotationWorkflowV1, assertSourceIdentityMatches } from "./validation";

export interface BeatmapSession {
  readonly task: CatalogTask;
  readonly sourceBytes: Uint8Array;
  readonly sourceText: string;
  readonly parsed: ParsedOsu;
  readonly chart: ManiaChart;
  readonly source: SourceIdentityV1;
  readonly chartEndMs: number;
  readonly noteRefs: ReadonlyMap<string, StableNoteRefV1>;
  readonly noteRefIndex: StableNoteRefIndexV1;
  readonly foundation: JudgmentFoundationV1;
  readonly document: AnnotationDocumentV1;
  readonly base: DraftBaseVersion | null;
  readonly restoredDraft?: AnnotationDraft;
}

export interface CreateGoldAnnotationInput {
  readonly annotationId?: string;
  readonly existing?: GoldAnnotationV1;
  readonly range: GoldAnnotationV1["range"];
  readonly noteIds: readonly string[];
  readonly labels: GoldAnnotationV1["labels"];
  readonly exemplarRoles?: readonly GoldExemplarRoleV1[];
  readonly judgmentNote?: string;
  readonly annotatorId: string;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export async function loadBeatmapSession(
  task: CatalogTask,
  catalog: CatalogSource,
  corpus: ReadableDirectoryHandle,
  directory: DatasetDirectory,
  sessions: SessionStore,
  now: () => string = () => new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID(),
): Promise<BeatmapSession> {
  const file = await readCatalogTask(corpus, task);
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const inspected = await inspectOsuSourceV1(sourceBytes);
  const refs = createStableNoteRefsV1(inspected.chart);
  const noteRefIndex = createStableNoteRefIndexV1(inspected.chart);
  const noteRefs = new Map(
    inspected.chart.notes.map((note, index) => [note.id, refs[index] as StableNoteRefV1]),
  );
  const stored = await directory.readAnnotation(inspected.source.sha256);
  const foundation = await directory.readFoundation(directory.manifest.currentFoundation);
  const document =
    stored?.document ??
    createAnnotationDocument(inspected.source, catalog.sha256, task.categories, now(), createId());

  if (stored) {
    assertSourceIdentityMatches(stored.document.source, inspected.source);
    await validateStoredDocument(
      stored,
      sourceBytes,
      inspected,
      noteRefIndex,
      directory,
      foundation,
    );
  }

  const restoredDraft = await sessions.getDraft(
    directory.manifest.datasetId,
    inspected.source.sha256,
  );

  return {
    task,
    sourceBytes,
    sourceText: inspected.text,
    parsed: inspected.parsed,
    chart: inspected.chart,
    source: inspected.source,
    chartEndMs: chartEndMs(inspected.chart),
    noteRefs,
    noteRefIndex,
    foundation,
    document,
    base: stored?.version ?? null,
    ...(restoredDraft ? { restoredDraft } : {}),
  };
}

export function createGoldAnnotation(
  session: Pick<BeatmapSession, "foundation" | "noteRefs">,
  input: CreateGoldAnnotationInput,
  foundation: FoundationRefV1,
): GoldAnnotationV1 {
  const now = input.now ?? (() => new Date().toISOString());
  const createId = input.createId ?? (() => crypto.randomUUID());
  const updatedAt = now();
  const noteRefs = input.noteIds.map((id) => {
    const ref = session.noteRefs.get(id);
    if (!ref) throw new Error(`Unknown runtime note ${id}`);
    return ref;
  });
  const labels = [...input.labels];
  const exemplarRoles = cleanExemplarRoles(
    input.exemplarRoles ?? input.existing?.exemplarRoles ?? [],
    labels,
  );
  const useCurrentFoundation =
    !input.existing ||
    !sameLabels(input.existing.labels, labels) ||
    hasAddedOrChangedRole(input.existing.exemplarRoles, exemplarRoles);
  if (useCurrentFoundation) {
    assertCurrentFoundationSupports(session.foundation, labels, exemplarRoles);
  }

  return {
    id: input.existing?.id ?? input.annotationId ?? createId(),
    range: input.range,
    noteRefs: dedupeRefs(noteRefs),
    labels,
    exemplarRoles,
    foundation: useCurrentFoundation ? foundation : input.existing.foundation,
    annotatorId: input.annotatorId,
    createdAt: input.existing?.createdAt ?? updatedAt,
    updatedAt,
    ...(input.judgmentNote?.trim() ? { judgmentNote: input.judgmentNote.trim() } : {}),
    derivedFromPredictionIds: input.existing?.derivedFromPredictionIds ?? [],
  };
}

export function createAnnotationDocument(
  source: SourceIdentityV1,
  catalogSha256: string,
  catalogTags: readonly string[],
  createdAt: string,
  documentId: string,
): AnnotationDocumentV1 {
  const suggestedTags = canonicalCatalogTagSeedsV1(catalogTags).map((tag) => tag.id);
  return {
    contract: ANNOTATION_CONTRACT,
    version: 1,
    documentId,
    source,
    seedContext: {
      catalogSha256,
      suggestedTags,
    },
    reviewState: "in-progress",
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    annotations: [],
    predictions: [],
    reviewNotes: [],
  };
}

export function noteIdsForRefs(
  session: Pick<BeatmapSession, "chart" | "noteRefs">,
  refs: readonly StableNoteRefV1[],
): readonly string[] {
  const keys = new Set(refs.map(stableNoteRefKey));
  return session.chart.notes.flatMap((note) => {
    const ref = session.noteRefs.get(note.id);
    return ref && keys.has(stableNoteRefKey(ref)) ? [note.id] : [];
  });
}

export function notesForIds(
  session: Pick<BeatmapSession, "chart">,
  noteIds: readonly string[],
): readonly ManiaNote[] {
  const ids = new Set(noteIds);
  return session.chart.notes.filter((note) => ids.has(note.id));
}

async function validateStoredDocument(
  stored: StoredAnnotation,
  sourceBytes: Uint8Array,
  inspected: Pick<BeatmapSession, "chart" | "source">,
  noteRefIndex: StableNoteRefIndexV1,
  directory: DatasetDirectory,
  currentFoundation: JudgmentFoundationV1,
): Promise<void> {
  const references = uniqueFoundationRefs(stored.document, directory.manifest.currentFoundation);
  const foundations = await Promise.all(
    references.map(async (reference) => ({
      foundation:
        reference.sha256 === directory.manifest.currentFoundation.sha256
          ? currentFoundation
          : await directory.readFoundation(reference),
      sha256: reference.sha256,
    })),
  );
  await assertAnnotationWorkflowV1(stored.document, {
    sourceBytes,
    chart: inspected.chart,
    foundations,
    inspected,
    noteRefIndex,
  });
}

function uniqueFoundationRefs(
  document: AnnotationDocumentV1,
  current: FoundationRefV1,
): readonly FoundationRefV1[] {
  const references = [
    current,
    ...document.annotations.map((annotation) => annotation.foundation),
    ...document.predictions.map((prediction) => prediction.foundation),
    ...document.reviewNotes.flatMap((note) =>
      note.resultingFoundation ? [note.resultingFoundation] : [],
    ),
  ];
  return [...new Map(references.map((reference) => [reference.sha256, reference])).values()];
}

function dedupeRefs(refs: readonly StableNoteRefV1[]): readonly StableNoteRefV1[] {
  return [...new Map(refs.map((ref) => [stableNoteRefKey(ref), ref])).values()];
}

function cleanExemplarRoles(
  roles: readonly GoldExemplarRoleV1[],
  labels: GoldAnnotationV1["labels"],
): readonly GoldExemplarRoleV1[] {
  const labelIds = new Set(labels.map((label) => label.tagId));
  const byTag = new Map(roles.map((role) => [role.tagId, role]));
  return [...byTag.values()]
    .filter((role) =>
      role.kind === "counterexample" ? !labelIds.has(role.tagId) : labelIds.has(role.tagId),
    )
    .sort(compareRoles);
}

function hasAddedOrChangedRole(
  existing: readonly GoldExemplarRoleV1[],
  next: readonly GoldExemplarRoleV1[],
): boolean {
  const existingKinds = new Map(existing.map((role) => [role.tagId, role.kind]));
  return next.some((role) => existingKinds.get(role.tagId) !== role.kind);
}

function sameLabels(left: GoldAnnotationV1["labels"], right: GoldAnnotationV1["labels"]): boolean {
  const sortedLeft = sortedLabels(left);
  const sortedRight = sortedLabels(right);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((label, index) => {
      const other = sortedRight[index];
      return other?.tagId === label.tagId && other.salience === label.salience;
    })
  );
}

function sortedLabels(labels: GoldAnnotationV1["labels"]): GoldAnnotationV1["labels"] {
  return [...labels].sort((left, right) =>
    left.tagId < right.tagId ? -1 : left.tagId > right.tagId ? 1 : 0,
  );
}

function assertCurrentFoundationSupports(
  foundation: JudgmentFoundationV1,
  labels: GoldAnnotationV1["labels"],
  roles: readonly GoldExemplarRoleV1[],
): void {
  for (const label of labels) assertActiveFoundationTagV1(foundation, label.tagId);
  for (const role of roles) assertActiveFoundationTagV1(foundation, role.tagId);
}

function compareRoles(left: GoldExemplarRoleV1, right: GoldExemplarRoleV1): number {
  return left.tagId < right.tagId
    ? -1
    : left.tagId > right.tagId
      ? 1
      : left.kind < right.kind
        ? -1
        : left.kind > right.kind
          ? 1
          : 0;
}
