import type { Sha256DigestFunction } from "./canonical-json";
import type {
  AnnotationDocumentV1,
  FoundationRefV1,
  GoldAnnotationV1,
  GoldExemplarRoleKindV1,
  GoldExemplarRoleV1,
  JudgmentFoundationV1,
  ReviewNoteStateV1,
  StableNoteRefV1,
  TimeRangeV1,
} from "./contracts";
import { assertActiveFoundationTagV1, foundationRefV1 } from "./foundation";
import { intersectRanges } from "./range";

export interface SetGoldExemplarRoleInputV1 {
  readonly tagId: string;
  readonly annotationId: string;
  readonly kind: GoldExemplarRoleKindV1;
  readonly now?: () => string;
}

export interface RemoveGoldExemplarRoleInputV1 {
  readonly tagId: string;
  readonly annotationId: string;
  readonly now?: () => string;
}

export interface AddReviewNoteInputV1 {
  readonly id?: string;
  readonly range?: TimeRangeV1;
  readonly noteRefs?: readonly StableNoteRefV1[];
  readonly text: string;
  readonly state?: ReviewNoteStateV1;
  readonly resultingFoundation?: FoundationRefV1;
  readonly resultingGoldAnnotationId?: string;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export interface ResolveReviewNoteInputV1 {
  readonly id: string;
  readonly resultingFoundation?: FoundationRefV1;
  readonly resultingGoldAnnotationId?: string;
  readonly now?: () => string;
}

export interface SameTagOverlapWarningV1 {
  readonly tagId: string;
  readonly leftAnnotationId: string;
  readonly rightAnnotationId: string;
  readonly overlap: TimeRangeV1;
}

export type ChartCompletionBlockerV1 =
  | "open-review-note"
  | "pending-prediction"
  | "uncommitted-draft";

export interface CompleteAnnotationDocumentInputV1 {
  readonly hasUncommittedDraft?: boolean;
  readonly now?: () => string;
}

export type CompleteAnnotationDocumentResultV1 =
  | {
      readonly ok: true;
      readonly document: AnnotationDocumentV1;
    }
  | {
      readonly ok: false;
      readonly blockers: readonly ChartCompletionBlockerV1[];
    };

export async function setGoldExemplarRoleV1(
  document: AnnotationDocumentV1,
  foundation: JudgmentFoundationV1,
  input: SetGoldExemplarRoleInputV1,
  digest?: Sha256DigestFunction,
): Promise<AnnotationDocumentV1> {
  const annotation = findGoldAnnotation(document, input.annotationId);
  const role = { kind: input.kind, tagId: input.tagId };
  const exemplarRoles = sortRoles([
    ...annotation.exemplarRoles.filter((candidate) => candidate.tagId !== role.tagId),
    role,
  ]);
  assertGoldAnnotationSupportedByFoundation({ ...annotation, exemplarRoles }, foundation);

  const updatedAt = input.now?.() ?? new Date().toISOString();
  const currentFoundation = await foundationRefV1(foundation, digest);
  return reviseGoldAnnotation(document, annotation.id, updatedAt, (entry) => ({
    ...entry,
    foundation: currentFoundation,
    exemplarRoles,
    updatedAt,
  }));
}

export function removeGoldExemplarRoleV1(
  document: AnnotationDocumentV1,
  input: RemoveGoldExemplarRoleInputV1,
): AnnotationDocumentV1 {
  const annotation = findGoldAnnotation(document, input.annotationId);
  if (!annotation.exemplarRoles.some((role) => role.tagId === input.tagId)) {
    throw new Error(`Gold annotation ${input.annotationId} does not have role ${input.tagId}`);
  }

  const updatedAt = input.now?.() ?? new Date().toISOString();
  return reviseGoldAnnotation(document, annotation.id, updatedAt, (entry) => ({
    ...entry,
    exemplarRoles: entry.exemplarRoles.filter((role) => role.tagId !== input.tagId),
    updatedAt,
  }));
}

export function addReviewNoteV1(
  document: AnnotationDocumentV1,
  input: AddReviewNoteInputV1,
): AnnotationDocumentV1 {
  assertResultingGoldAnnotation(document, input.resultingGoldAnnotationId);
  const createdAt = input.now?.() ?? new Date().toISOString();
  const text = input.text.trim();
  if (!text) throw new Error("Review note text is required");

  return reviseDocument(document, createdAt, {
    ...(input.state === "resolved" ? {} : { reviewState: "in-progress" }),
    reviewNotes: [
      ...document.reviewNotes,
      {
        id: input.id ?? input.createId?.() ?? crypto.randomUUID(),
        ...(input.range ? { range: copyRange(input.range) } : {}),
        ...(input.noteRefs ? { noteRefs: input.noteRefs.map(copyNoteRef) } : {}),
        text,
        state: input.state ?? "open",
        createdAt,
        ...(input.resultingFoundation
          ? { resultingFoundation: { ...input.resultingFoundation } }
          : {}),
        ...(input.resultingGoldAnnotationId
          ? { resultingGoldAnnotationId: input.resultingGoldAnnotationId }
          : {}),
      },
    ],
  });
}

export function resolveReviewNoteV1(
  document: AnnotationDocumentV1,
  input: ResolveReviewNoteInputV1,
): AnnotationDocumentV1 {
  assertResultingGoldAnnotation(document, input.resultingGoldAnnotationId);
  if (!document.reviewNotes.some((note) => note.id === input.id)) {
    throw new Error(`Review note ${input.id} does not exist`);
  }
  const updatedAt = input.now?.() ?? new Date().toISOString();

  return reviseDocument(document, updatedAt, {
    reviewNotes: document.reviewNotes.map((note) =>
      note.id === input.id
        ? {
            ...note,
            state: "resolved",
            ...(input.resultingFoundation
              ? { resultingFoundation: { ...input.resultingFoundation } }
              : {}),
            ...(input.resultingGoldAnnotationId
              ? { resultingGoldAnnotationId: input.resultingGoldAnnotationId }
              : {}),
          }
        : note,
    ),
  });
}

export function sameTagOverlapWarningsV1(
  document: Pick<AnnotationDocumentV1, "annotations">,
  candidate?: GoldAnnotationV1,
): readonly SameTagOverlapWarningV1[] {
  const annotations = candidate
    ? [...document.annotations.filter((annotation) => annotation.id !== candidate.id), candidate]
    : document.annotations;
  const warnings: SameTagOverlapWarningV1[] = [];

  annotations.forEach((left, leftIndex) => {
    for (const right of annotations.slice(leftIndex + 1)) {
      const overlap = intersectRanges(left.range, right.range);
      if (!overlap) continue;

      const rightTags = new Set(right.labels.map((label) => label.tagId));
      for (const label of left.labels) {
        if (!rightTags.has(label.tagId)) continue;
        warnings.push({
          tagId: label.tagId,
          leftAnnotationId: left.id,
          rightAnnotationId: right.id,
          overlap,
        });
      }
    }
  });

  return warnings;
}

export function completeAnnotationDocumentV1(
  document: AnnotationDocumentV1,
  input: CompleteAnnotationDocumentInputV1 = {},
): CompleteAnnotationDocumentResultV1 {
  const blockers: ChartCompletionBlockerV1[] = [];
  if (input.hasUncommittedDraft) blockers.push("uncommitted-draft");
  if (document.reviewNotes.some((note) => note.state === "open")) {
    blockers.push("open-review-note");
  }
  if (document.predictions.some((prediction) => prediction.reviewStatus === "pending")) {
    blockers.push("pending-prediction");
  }
  if (blockers.length > 0) return { ok: false, blockers };
  if (document.reviewState === "complete") return { ok: true, document };

  return {
    ok: true,
    document: reviseDocument(document, input.now?.() ?? new Date().toISOString(), {
      reviewState: "complete",
    }),
  };
}

function reviseDocument(
  document: AnnotationDocumentV1,
  updatedAt: string,
  patch: Partial<Pick<AnnotationDocumentV1, "annotations" | "reviewNotes" | "reviewState">>,
): AnnotationDocumentV1 {
  return {
    ...document,
    ...patch,
    revision: document.revision + 1,
    updatedAt,
  };
}

function reviseGoldAnnotation(
  document: AnnotationDocumentV1,
  annotationId: string,
  updatedAt: string,
  update: (annotation: GoldAnnotationV1) => GoldAnnotationV1,
): AnnotationDocumentV1 {
  return reviseDocument(document, updatedAt, {
    annotations: document.annotations.map((annotation) =>
      annotation.id === annotationId ? update(annotation) : annotation,
    ),
  });
}

function assertResultingGoldAnnotation(
  document: AnnotationDocumentV1,
  annotationId: string | undefined,
): void {
  if (annotationId && !document.annotations.some((annotation) => annotation.id === annotationId)) {
    throw new Error(`Gold annotation ${annotationId} does not exist`);
  }
}

function findGoldAnnotation(
  document: AnnotationDocumentV1,
  annotationId: string,
): GoldAnnotationV1 {
  const annotation = document.annotations.find((entry) => entry.id === annotationId);
  if (!annotation) throw new Error(`Gold annotation ${annotationId} does not exist`);
  return annotation;
}

function assertRoleCompatibleWithLabels(
  annotation: GoldAnnotationV1,
  role: GoldExemplarRoleV1,
): void {
  const hasLabel = annotation.labels.some((label) => label.tagId === role.tagId);
  if (role.kind === "counterexample" && hasLabel) {
    throw new Error(`Counterexample annotation ${annotation.id} is labeled ${role.tagId}`);
  }
  if (role.kind !== "counterexample" && !hasLabel) {
    throw new Error(`Gold annotation ${annotation.id} is not labeled ${role.tagId}`);
  }
}

function assertGoldAnnotationSupportedByFoundation(
  annotation: GoldAnnotationV1,
  foundation: JudgmentFoundationV1,
): void {
  for (const label of annotation.labels) assertActiveFoundationTagV1(foundation, label.tagId);
  for (const role of annotation.exemplarRoles) {
    assertActiveFoundationTagV1(foundation, role.tagId);
    assertRoleCompatibleWithLabels(annotation, role);
  }
}

function sortRoles(roles: readonly GoldExemplarRoleV1[]): readonly GoldExemplarRoleV1[] {
  return [...roles].sort((left, right) =>
    left.tagId < right.tagId
      ? -1
      : left.tagId > right.tagId
        ? 1
        : left.kind < right.kind
          ? -1
          : left.kind > right.kind
            ? 1
            : 0,
  );
}

function copyRange(range: TimeRangeV1): TimeRangeV1 {
  return { endMs: range.endMs, startMs: range.startMs };
}

function copyNoteRef(ref: StableNoteRefV1): StableNoteRefV1 {
  return {
    column: ref.column,
    endMs: ref.endMs,
    kind: ref.kind,
    sourceLine: ref.sourceLine,
    startMs: ref.startMs,
  };
}
