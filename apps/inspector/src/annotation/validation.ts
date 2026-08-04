import type { ManiaChart } from "beatmap-lens";
import { hashFoundationV1, serializeCanonicalJson } from "./canonical-json";
import type {
  AnnotationDocumentV1,
  DatasetManifestV1,
  FoundationTagV1,
  GoldAnnotationV1,
  JudgmentFoundationV1,
  SilverPredictionV1,
  SourceIdentityV1,
  StableNoteRefV1,
  ValidationIssue,
  ValidationResult,
} from "./contracts";
import { ANNOTATION_CONTRACT, DATASET_CONTRACT, FOUNDATION_CONTRACT } from "./contracts";
import { FOUNDATION_POLICIES_V1, isCanonicalTagId } from "./foundation";
import { chartEndMs, noteIntersectsRange } from "./range";
import { inspectOsuSourceV1 } from "./source-identity";
import {
  createStableNoteRefIndexV1,
  resolveStableNoteRefsV1,
  type StableNoteRefIndexV1,
  stableNoteRefKey,
} from "./stable-note-ref";

export interface FoundationSnapshotV1 {
  readonly foundation: JudgmentFoundationV1;
  readonly sha256?: string;
}

export interface AnnotationWorkflowValidationContextV1 {
  readonly sourceBytes: Uint8Array;
  readonly chart: Pick<ManiaChart, "notes">;
  readonly foundations: readonly FoundationSnapshotV1[];
  readonly hasUncommittedDraft?: boolean;
  readonly inspected?: {
    readonly chart: Pick<ManiaChart, "notes">;
    readonly source: SourceIdentityV1;
  };
  readonly noteRefIndex?: StableNoteRefIndexV1;
}

export function validateDatasetManifestV1(value: unknown): ValidationResult<DatasetManifestV1> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return failure("$", "Expected an object");
  exactKeys(
    value,
    [
      "contract",
      "version",
      "datasetId",
      "name",
      "createdAt",
      "updatedAt",
      "currentFoundation",
      "catalogSources",
      "annotationContractVersion",
    ],
    "$",
    issues,
  );

  literal(value.contract, DATASET_CONTRACT, "$.contract", issues);
  literal(value.version, 1, "$.version", issues);
  uuid(value.datasetId, "$.datasetId", issues);
  nonEmptyString(value.name, "$.name", issues);
  timestamp(value.createdAt, "$.createdAt", issues);
  timestamp(value.updatedAt, "$.updatedAt", issues);
  foundationRef(value.currentFoundation, "$.currentFoundation", issues);
  literal(value.annotationContractVersion, 1, "$.annotationContractVersion", issues);

  if (!Array.isArray(value.catalogSources)) {
    add(issues, "$.catalogSources", "Expected an array");
  } else {
    value.catalogSources.forEach((source, index) => {
      const path = `$.catalogSources[${index}]`;
      if (!isRecord(source)) {
        add(issues, path, "Expected an object");
        return;
      }
      exactKeys(source, ["url", "csvSha256"], path, issues);
      webUrl(source.url, `${path}.url`, issues);
      sha256(source.csvSha256, `${path}.csvSha256`, issues);
    });
  }

  rejectPathFields(value, "$", issues);
  return result(value, issues);
}

export function assertDatasetManifestV1(value: unknown): asserts value is DatasetManifestV1 {
  assertValid(validateDatasetManifestV1(value), "Invalid dataset manifest");
}

export function validateJudgmentFoundationV1(
  value: unknown,
): ValidationResult<JudgmentFoundationV1> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return failure("$", "Expected an object");
  exactKeys(
    value,
    [
      "contract",
      "version",
      "foundationId",
      "revision",
      "parentSha256",
      "language",
      "creatorId",
      "createdAt",
      "policies",
      "tags",
    ],
    "$",
    issues,
  );

  literal(value.contract, FOUNDATION_CONTRACT, "$.contract", issues);
  literal(value.version, 1, "$.version", issues);
  uuid(value.foundationId, "$.foundationId", issues);
  positiveInteger(value.revision, "$.revision", issues);
  if (value.parentSha256 !== undefined) sha256(value.parentSha256, "$.parentSha256", issues);
  literal(value.language, "zh-CN", "$.language", issues);
  nonEmptyString(value.creatorId, "$.creatorId", issues);
  timestamp(value.createdAt, "$.createdAt", issues);
  if (!sameJson(value.policies, FOUNDATION_POLICIES_V1)) {
    add(issues, "$.policies", "Expected the immutable v1 global policies");
  }

  if (!Array.isArray(value.tags)) {
    add(issues, "$.tags", "Expected an array");
  } else {
    value.tags.forEach((tag, index) => {
      validateFoundationTag(tag, `$.tags[${index}]`, issues);
    });
    unique(
      value.tags.flatMap((tag) => (isRecord(tag) && typeof tag.id === "string" ? [tag.id] : [])),
      "$.tags",
      "tag ID",
      issues,
    );
  }

  rejectPathFields(value, "$", issues);
  return result(value, issues);
}

export function assertJudgmentFoundationV1(value: unknown): asserts value is JudgmentFoundationV1 {
  assertValid(validateJudgmentFoundationV1(value), "Invalid Judgment Foundation");
}

export function validateAnnotationDocumentV1(
  value: unknown,
): ValidationResult<AnnotationDocumentV1> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return failure("$", "Expected an object");
  exactKeys(
    value,
    [
      "contract",
      "version",
      "documentId",
      "source",
      "seedContext",
      "reviewState",
      "revision",
      "createdAt",
      "updatedAt",
      "annotations",
      "predictions",
      "reviewNotes",
    ],
    "$",
    issues,
  );

  literal(value.contract, ANNOTATION_CONTRACT, "$.contract", issues);
  literal(value.version, 1, "$.version", issues);
  uuid(value.documentId, "$.documentId", issues);
  validateSourceIdentity(value.source, "$.source", issues);
  validateSeedContext(value.seedContext, "$.seedContext", issues);
  oneOf(value.reviewState, ["in-progress", "complete"], "$.reviewState", issues);
  positiveInteger(value.revision, "$.revision", issues);
  timestamp(value.createdAt, "$.createdAt", issues);
  timestamp(value.updatedAt, "$.updatedAt", issues);

  validateArray(value.annotations, "$.annotations", issues, validateGoldAnnotation);
  validateArray(value.predictions, "$.predictions", issues, validateSilverPrediction);
  validateArray(value.reviewNotes, "$.reviewNotes", issues, validateReviewNote);

  const ids = [
    value.documentId,
    ...collectIds(value.annotations),
    ...collectIds(value.predictions),
    ...collectIds(value.reviewNotes),
  ].filter((id): id is string => typeof id === "string");
  unique(ids, "$", "document record ID", issues);
  rejectPathFields(value, "$", issues);
  return result(value, issues);
}

export function assertAnnotationDocumentV1(value: unknown): asserts value is AnnotationDocumentV1 {
  assertValid(validateAnnotationDocumentV1(value), "Invalid annotation document");
}

export async function validateAnnotationWorkflowV1(
  document: AnnotationDocumentV1,
  context: AnnotationWorkflowValidationContextV1,
): Promise<ValidationResult<AnnotationDocumentV1>> {
  const structural = validateAnnotationDocumentV1(document);
  if (!structural.ok) return structural;

  const issues: ValidationIssue[] = [];
  try {
    const inspected = context.inspected ?? (await inspectOsuSourceV1(context.sourceBytes));
    assertSourceIdentityMatches(document.source, inspected.source);
    if (!sameNormalizedNotes(context.chart.notes, inspected.chart.notes)) {
      add(
        issues,
        "$.source",
        "The supplied normalized chart does not match the exact source bytes",
      );
    }
  } catch (error) {
    add(issues, "$.source", errorMessage(error));
  }

  const foundations = await Promise.all(
    context.foundations.map(async (snapshot, index) => {
      const foundationValidation = validateJudgmentFoundationV1(snapshot.foundation);
      if (!foundationValidation.ok) {
        for (const issue of foundationValidation.issues) {
          add(issues, `$.foundations[${index}]${issue.path.slice(1)}`, issue.message);
        }
      }
      const sha256 = await hashFoundationV1(snapshot.foundation);
      if (snapshot.sha256 !== undefined && snapshot.sha256 !== sha256) {
        add(
          issues,
          `$.foundations[${index}].sha256`,
          "Foundation bytes do not match the supplied digest",
        );
      }
      return { foundation: snapshot.foundation, sha256 };
    }),
  );
  const endMs = chartEndMs(context.chart);
  const noteRefIndex = context.noteRefIndex ?? createStableNoteRefIndexV1(context.chart);
  if (document.source.noteCount !== context.chart.notes.length) {
    add(issues, "$.source.noteCount", "Source note count does not match the normalized chart");
  }

  for (const [index, annotation] of document.annotations.entries()) {
    await validateTargetWorkflow(
      annotation,
      `$.annotations[${index}]`,
      noteRefIndex,
      foundations,
      endMs,
      issues,
    );
  }
  for (const [index, prediction] of document.predictions.entries()) {
    await validateTargetWorkflow(
      prediction,
      `$.predictions[${index}]`,
      noteRefIndex,
      foundations,
      endMs,
      issues,
    );
  }
  for (const [index, reviewNote] of document.reviewNotes.entries()) {
    const path = `$.reviewNotes[${index}]`;
    if (reviewNote.range && (reviewNote.range.startMs < 0 || reviewNote.range.endMs > endMs)) {
      add(issues, `${path}.range`, `Expected 0 <= startMs < endMs <= ${endMs}`);
    }
    if (reviewNote.noteRefs) {
      const range = reviewNote.range;
      try {
        const notes = resolveStableNoteRefsV1(noteRefIndex, reviewNote.noteRefs);
        if (range && notes.some((note) => !noteIntersectsRange(note, range))) {
          add(issues, `${path}.noteRefs`, "Every selected note must intersect the half-open range");
        }
      } catch (error) {
        add(issues, `${path}.noteRefs`, errorMessage(error));
      }
    }
    if (
      reviewNote.resultingFoundation &&
      !foundations.some(
        ({ foundation, sha256 }) =>
          foundation.foundationId === reviewNote.resultingFoundation?.foundationId &&
          foundation.revision === reviewNote.resultingFoundation.revision &&
          sha256 === reviewNote.resultingFoundation.sha256,
      )
    ) {
      add(
        issues,
        `${path}.resultingFoundation`,
        "The resulting Foundation snapshot is unavailable",
      );
    }
    if (
      reviewNote.resultingGoldAnnotationId &&
      !document.annotations.some(
        (annotation) => annotation.id === reviewNote.resultingGoldAnnotationId,
      )
    ) {
      add(
        issues,
        `${path}.resultingGoldAnnotationId`,
        "The resulting gold annotation does not exist",
      );
    }
  }

  validateDuplicateGoldTargets(document.annotations, issues);
  validateProvenance(document, issues);
  if (document.reviewState === "complete") {
    if (context.hasUncommittedDraft) {
      add(issues, "$.reviewState", "A document with an uncommitted draft cannot be complete");
    }
    if (document.reviewNotes.some((note) => note.state === "open")) {
      add(issues, "$.reviewState", "A document with an open review note cannot be complete");
    }
    if (document.predictions.some((prediction) => prediction.reviewStatus === "pending")) {
      add(issues, "$.reviewState", "A document with a pending prediction cannot be complete");
    }
  }

  return issues.length === 0 ? { ok: true, value: document } : { ok: false, issues };
}

export async function assertAnnotationWorkflowV1(
  document: AnnotationDocumentV1,
  context: AnnotationWorkflowValidationContextV1,
): Promise<void> {
  assertValid(await validateAnnotationWorkflowV1(document, context), "Invalid annotation workflow");
}

export function assertSourceIdentityMatches(
  expected: SourceIdentityV1,
  actual: SourceIdentityV1,
): void {
  if (expected.sha256 !== actual.sha256) {
    throw new Error(
      `Source SHA-256 mismatch: expected ${expected.sha256}, received ${actual.sha256}`,
    );
  }
  if (expected.byteLength !== actual.byteLength) {
    throw new Error(
      `Source byte length mismatch: expected ${expected.byteLength}, received ${actual.byteLength}`,
    );
  }
  for (const field of [
    "osuFormatVersion",
    "beatmapId",
    "beatmapSetId",
    "title",
    "artist",
    "creator",
    "difficulty",
    "keyCount",
    "noteCount",
    "normalizerId",
  ] as const) {
    if (expected[field] !== actual[field]) {
      throw new Error(
        `Source identity mismatch at ${field}: expected ${String(expected[field])}, received ${String(actual[field])}`,
      );
    }
  }
}

export function validateCompatibleFoundationRevisionV1(
  parent: JudgmentFoundationV1,
  next: JudgmentFoundationV1,
  parentSha256: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (next.foundationId !== parent.foundationId) {
    add(issues, "$.foundationId", "A compatible revision must retain the Foundation ID");
  }
  if (next.revision !== parent.revision + 1) {
    add(issues, "$.revision", "A compatible revision must increment the revision by one");
  }
  if (next.parentSha256 !== parentSha256) {
    add(issues, "$.parentSha256", "A compatible revision must pin its exact parent digest");
  }
  if (next.version !== parent.version || next.language !== parent.language) {
    add(issues, "$", "A compatible revision cannot change its contract version or language");
  }
  if (!sameJson(next.policies, parent.policies)) {
    add(issues, "$.policies", "Foundation v1 global policies are immutable");
  }

  for (const oldTag of parent.tags) {
    const newTag = next.tags.find((tag) => tag.id === oldTag.id);
    if (!newTag) {
      add(issues, "$.tags", `A compatible revision cannot remove tag ${oldTag.id}`);
      continue;
    }
    if (oldTag.status === "active") validateActiveTagCompatibility(oldTag, newTag, issues);
    if (oldTag.status === "retired" && !sameJson(oldTag, newTag)) {
      add(issues, `$.tags.${oldTag.id}`, "A retired tag is immutable");
    }
  }
  return issues;
}

function validateFoundationTag(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(
    value,
    [
      "id",
      "displayName",
      "status",
      "definition",
      "inclusionCues",
      "exclusionCues",
      "aliases",
      "salienceClarification",
    ],
    path,
    issues,
  );
  if (typeof value.id !== "string" || !isCanonicalTagId(value.id)) {
    add(issues, `${path}.id`, "Expected a lowercase kebab-case tag ID");
  }
  nonEmptyString(value.displayName, `${path}.displayName`, issues);
  oneOf(value.status, ["active", "retired"], `${path}.status`, issues);
  string(value.definition, `${path}.definition`, issues);
  stringArray(value.inclusionCues, `${path}.inclusionCues`, issues);
  if (value.exclusionCues !== undefined) {
    stringArray(value.exclusionCues, `${path}.exclusionCues`, issues);
  }
  stringArray(value.aliases, `${path}.aliases`, issues);
  if (value.salienceClarification !== undefined) {
    nonEmptyString(value.salienceClarification, `${path}.salienceClarification`, issues);
  }
  if (value.status === "active" || value.status === "retired") {
    nonEmptyString(value.definition, `${path}.definition`, issues);
    if (!Array.isArray(value.inclusionCues) || value.inclusionCues.length === 0) {
      add(issues, `${path}.inclusionCues`, "An active or retired tag requires an inclusion cue");
    }
  }
}

function validateSourceIdentity(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(
    value,
    [
      "sha256",
      "byteLength",
      "osuFormatVersion",
      "beatmapId",
      "beatmapSetId",
      "title",
      "artist",
      "creator",
      "difficulty",
      "keyCount",
      "noteCount",
      "normalizerId",
    ],
    path,
    issues,
  );
  sha256(value.sha256, `${path}.sha256`, issues);
  nonNegativeInteger(value.byteLength, `${path}.byteLength`, issues);
  positiveInteger(value.osuFormatVersion, `${path}.osuFormatVersion`, issues);
  if (value.beatmapId !== undefined) integer(value.beatmapId, `${path}.beatmapId`, issues);
  if (value.beatmapSetId !== undefined) integer(value.beatmapSetId, `${path}.beatmapSetId`, issues);
  nonEmptyString(value.title, `${path}.title`, issues);
  nonEmptyString(value.artist, `${path}.artist`, issues);
  nonEmptyString(value.creator, `${path}.creator`, issues);
  nonEmptyString(value.difficulty, `${path}.difficulty`, issues);
  if (
    !Number.isInteger(value.keyCount) ||
    (value.keyCount as number) < 4 ||
    (value.keyCount as number) > 7
  ) {
    add(issues, `${path}.keyCount`, "Expected a supported mania key count from 4 through 7");
  }
  nonNegativeInteger(value.noteCount, `${path}.noteCount`, issues);
  literal(value.normalizerId, "beatmap-lens-mania-v1", `${path}.normalizerId`, issues);
}

function validateSeedContext(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(value, ["catalogSha256", "suggestedTags"], path, issues);
  sha256(value.catalogSha256, `${path}.catalogSha256`, issues);
  stringArray(value.suggestedTags, `${path}.suggestedTags`, issues);
  if (Array.isArray(value.suggestedTags)) {
    value.suggestedTags.forEach((tagId, index) => {
      if (typeof tagId === "string" && !isCanonicalTagId(tagId)) {
        add(issues, `${path}.suggestedTags[${index}]`, "Expected a lowercase kebab-case tag ID");
      }
    });
    unique(value.suggestedTags, `${path}.suggestedTags`, "suggested tag", issues);
  }
}

function validateGoldAnnotation(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(
    value,
    [
      "id",
      "range",
      "noteRefs",
      "labels",
      "exemplarRoles",
      "foundation",
      "annotatorId",
      "createdAt",
      "updatedAt",
      "judgmentNote",
      "derivedFromPredictionIds",
    ],
    path,
    issues,
  );
  uuid(value.id, `${path}.id`, issues);
  validateRange(value.range, `${path}.range`, issues);
  validateNoteRefs(value.noteRefs, `${path}.noteRefs`, issues, true);
  validateLabels(value.labels, `${path}.labels`, issues, true);
  validateGoldExemplarRoles(value.exemplarRoles, `${path}.exemplarRoles`, issues);
  foundationRef(value.foundation, `${path}.foundation`, issues);
  nonEmptyString(value.annotatorId, `${path}.annotatorId`, issues);
  timestamp(value.createdAt, `${path}.createdAt`, issues);
  timestamp(value.updatedAt, `${path}.updatedAt`, issues);
  if (value.judgmentNote !== undefined) string(value.judgmentNote, `${path}.judgmentNote`, issues);
  stringArray(value.derivedFromPredictionIds, `${path}.derivedFromPredictionIds`, issues);
  if (Array.isArray(value.derivedFromPredictionIds)) {
    value.derivedFromPredictionIds.forEach((id, index) => {
      uuid(id, `${path}.derivedFromPredictionIds[${index}]`, issues);
    });
    unique(
      value.derivedFromPredictionIds,
      `${path}.derivedFromPredictionIds`,
      "prediction ID",
      issues,
    );
  }
}

function validateSilverPrediction(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(
    value,
    [
      "id",
      "range",
      "noteRefs",
      "labels",
      "foundation",
      "producerId",
      "skillVersion",
      "modelVersion",
      "confidence",
      "reviewStatus",
      "resultingGoldAnnotationId",
      "createdAt",
    ],
    path,
    issues,
  );
  uuid(value.id, `${path}.id`, issues);
  validateRange(value.range, `${path}.range`, issues);
  validateNoteRefs(value.noteRefs, `${path}.noteRefs`, issues, true);
  validateLabels(value.labels, `${path}.labels`, issues, true);
  foundationRef(value.foundation, `${path}.foundation`, issues);
  nonEmptyString(value.producerId, `${path}.producerId`, issues);
  nonEmptyString(value.skillVersion, `${path}.skillVersion`, issues);
  nonEmptyString(value.modelVersion, `${path}.modelVersion`, issues);
  if (
    value.confidence !== undefined &&
    (typeof value.confidence !== "number" ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1)
  ) {
    add(issues, `${path}.confidence`, "Expected a confidence from 0 through 1");
  }
  oneOf(value.reviewStatus, ["pending", "reviewed", "rejected"], `${path}.reviewStatus`, issues);
  if (value.resultingGoldAnnotationId !== undefined) {
    uuid(value.resultingGoldAnnotationId, `${path}.resultingGoldAnnotationId`, issues);
  }
  timestamp(value.createdAt, `${path}.createdAt`, issues);
}

function validateReviewNote(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(
    value,
    [
      "id",
      "range",
      "noteRefs",
      "text",
      "state",
      "createdAt",
      "resultingFoundation",
      "resultingGoldAnnotationId",
    ],
    path,
    issues,
  );
  uuid(value.id, `${path}.id`, issues);
  if (value.range !== undefined) validateRange(value.range, `${path}.range`, issues);
  if (value.noteRefs !== undefined)
    validateNoteRefs(value.noteRefs, `${path}.noteRefs`, issues, false);
  nonEmptyString(value.text, `${path}.text`, issues);
  oneOf(value.state, ["open", "resolved"], `${path}.state`, issues);
  timestamp(value.createdAt, `${path}.createdAt`, issues);
  if (value.resultingFoundation !== undefined) {
    foundationRef(value.resultingFoundation, `${path}.resultingFoundation`, issues);
  }
  if (value.resultingGoldAnnotationId !== undefined) {
    uuid(value.resultingGoldAnnotationId, `${path}.resultingGoldAnnotationId`, issues);
  }
}

async function validateTargetWorkflow(
  target: GoldAnnotationV1 | SilverPredictionV1,
  path: string,
  noteRefIndex: StableNoteRefIndexV1,
  foundations: readonly Required<FoundationSnapshotV1>[],
  endMs: number,
  issues: ValidationIssue[],
): Promise<void> {
  if (target.range.startMs < 0 || target.range.endMs > endMs) {
    add(issues, `${path}.range`, `Expected 0 <= startMs < endMs <= ${endMs}`);
  }

  let notes: Awaited<ReturnType<typeof resolveStableNoteRefsV1>> = [];
  try {
    notes = resolveStableNoteRefsV1(noteRefIndex, target.noteRefs);
  } catch (error) {
    add(issues, `${path}.noteRefs`, errorMessage(error));
  }
  if (notes.some((note) => !noteIntersectsRange(note, target.range))) {
    add(issues, `${path}.noteRefs`, "Every selected note must intersect the half-open range");
  }

  const snapshot = foundations.find(
    ({ foundation, sha256 }) =>
      foundation.foundationId === target.foundation.foundationId &&
      foundation.revision === target.foundation.revision &&
      sha256 === target.foundation.sha256,
  );
  if (!snapshot) {
    add(issues, `${path}.foundation`, "The pinned Foundation snapshot or digest is unavailable");
    return;
  }

  for (const [index, label] of target.labels.entries()) {
    const tag = snapshot.foundation.tags.find((entry) => entry.id === label.tagId);
    if (!tag) {
      add(issues, `${path}.labels[${index}].tagId`, `Foundation does not define ${label.tagId}`);
    } else if (tag.status !== "active") {
      add(
        issues,
        `${path}.labels[${index}].tagId`,
        `Labels require an active tag; ${tag.id} is ${tag.status}`,
      );
    }
  }

  if (isGoldAnnotation(target)) {
    validateGoldExemplarRolesWorkflow(target, path, snapshot.foundation, issues);
  }
}

function validateDuplicateGoldTargets(
  annotations: readonly GoldAnnotationV1[],
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  annotations.forEach((annotation, index) => {
    const notes = annotation.noteRefs.map(stableNoteRefKey).sort().join("|");
    const tags = annotation.labels
      .map((label) => label.tagId)
      .sort()
      .join("|");
    const key = `${annotation.range.startMs}:${annotation.range.endMs}/${notes}/${tags}`;
    if (seen.has(key)) add(issues, `$.annotations[${index}]`, "Exact duplicate gold annotation");
    seen.add(key);
  });
}

function validateProvenance(document: AnnotationDocumentV1, issues: ValidationIssue[]): void {
  const predictions = new Map(
    document.predictions.map((prediction) => [prediction.id, prediction]),
  );
  const annotations = new Map(
    document.annotations.map((annotation) => [annotation.id, annotation]),
  );

  document.annotations.forEach((annotation, annotationIndex) => {
    annotation.derivedFromPredictionIds.forEach((id, predictionIndex) => {
      if (!predictions.has(id)) {
        add(
          issues,
          `$.annotations[${annotationIndex}].derivedFromPredictionIds[${predictionIndex}]`,
          `Prediction ${id} does not exist`,
        );
      }
    });
  });
  document.predictions.forEach((prediction, index) => {
    if (!prediction.resultingGoldAnnotationId) return;
    const gold = annotations.get(prediction.resultingGoldAnnotationId);
    if (!gold?.derivedFromPredictionIds.includes(prediction.id)) {
      add(
        issues,
        `$.predictions[${index}].resultingGoldAnnotationId`,
        "Resulting gold provenance must point back to this unchanged prediction",
      );
    }
  });
}

function validateActiveTagCompatibility(
  oldTag: FoundationTagV1,
  newTag: FoundationTagV1,
  issues: ValidationIssue[],
): void {
  const path = `$.tags.${oldTag.id}`;
  if (
    newTag.displayName !== oldTag.displayName ||
    newTag.definition !== oldTag.definition ||
    newTag.salienceClarification !== oldTag.salienceClarification
  ) {
    add(issues, path, "An active tag's established meaning is immutable in Foundation v1");
  }
  for (const [field, oldValues, newValues] of [
    ["aliases", oldTag.aliases, newTag.aliases],
    ["inclusionCues", oldTag.inclusionCues, newTag.inclusionCues],
    ["exclusionCues", oldTag.exclusionCues ?? [], newTag.exclusionCues ?? []],
  ] as const) {
    if (oldValues.some((value) => !newValues.includes(value))) {
      add(issues, `${path}.${field}`, `A compatible revision may add but not remove ${field}`);
    }
  }
}

function validateRange(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(value, ["startMs", "endMs"], path, issues);
  finiteNumber(value.startMs, `${path}.startMs`, issues);
  finiteNumber(value.endMs, `${path}.endMs`, issues);
  if (
    typeof value.startMs === "number" &&
    typeof value.endMs === "number" &&
    value.startMs >= value.endMs
  ) {
    add(issues, path, "Expected a non-empty half-open range with startMs < endMs");
  }
}

function validateNoteRefs(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  nonEmpty: boolean,
): void {
  if (!Array.isArray(value)) {
    add(issues, path, "Expected an array");
    return;
  }
  if (nonEmpty && value.length === 0) add(issues, path, "Expected at least one note reference");
  value.forEach((ref, index) => {
    validateNoteRef(ref, `${path}[${index}]`, issues);
  });
  unique(
    value.flatMap((ref) => (isStableNoteRefLike(ref) ? [stableNoteRefKey(ref)] : [])),
    path,
    "stable note reference",
    issues,
  );
}

function validateNoteRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(value, ["sourceLine", "column", "kind", "startMs", "endMs"], path, issues);
  positiveInteger(value.sourceLine, `${path}.sourceLine`, issues);
  nonNegativeInteger(value.column, `${path}.column`, issues);
  oneOf(value.kind, ["normal", "long"], `${path}.kind`, issues);
  finiteNumber(value.startMs, `${path}.startMs`, issues);
  finiteNumber(value.endMs, `${path}.endMs`, issues);
  if (
    typeof value.startMs === "number" &&
    typeof value.endMs === "number" &&
    (value.endMs < value.startMs || (value.kind === "long" && value.endMs <= value.startMs))
  ) {
    add(issues, path, "Stable note timing does not match its kind");
  }
}

function validateGoldExemplarRoles(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, path, "Expected an array");
    return;
  }
  value.forEach((role, index) => {
    validateGoldExemplarRole(role, `${path}[${index}]`, issues);
  });
  unique(
    value.flatMap((role) => (isRecord(role) && typeof role.tagId === "string" ? [role.tagId] : [])),
    path,
    "exemplar role tag ID",
    issues,
  );
}

function validateGoldExemplarRole(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(value, ["tagId", "kind"], path, issues);
  if (typeof value.tagId !== "string" || !isCanonicalTagId(value.tagId)) {
    add(issues, `${path}.tagId`, "Expected a lowercase kebab-case tag ID");
  }
  oneOf(value.kind, ["strong", "weak", "counterexample"], `${path}.kind`, issues);
}

function validateLabels(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  nonEmpty: boolean,
): void {
  if (!Array.isArray(value)) {
    add(issues, path, "Expected an array");
    return;
  }
  if (nonEmpty && value.length === 0) add(issues, path, "Expected at least one label");
  value.forEach((label, index) => {
    validateLabel(label, `${path}[${index}]`, issues);
  });
  unique(
    value.flatMap((label) =>
      isRecord(label) && typeof label.tagId === "string" ? [label.tagId] : [],
    ),
    path,
    "tag ID",
    issues,
  );
}

function validateLabel(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(value, ["tagId", "salience"], path, issues);
  if (typeof value.tagId !== "string" || !isCanonicalTagId(value.tagId)) {
    add(issues, `${path}.tagId`, "Expected a lowercase kebab-case tag ID");
  }
  if (value.salience !== 1 && value.salience !== 2) {
    add(issues, `${path}.salience`, "Salience must be exactly 1 or 2");
  }
}

function foundationRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "Expected an object");
    return;
  }
  exactKeys(value, ["foundationId", "revision", "sha256"], path, issues);
  uuid(value.foundationId, `${path}.foundationId`, issues);
  positiveInteger(value.revision, `${path}.revision`, issues);
  sha256(value.sha256, `${path}.sha256`, issues);
}

function validateArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  validateEntry: (value: unknown, path: string, issues: ValidationIssue[]) => void,
): void {
  if (!Array.isArray(value)) {
    add(issues, path, "Expected an array");
    return;
  }
  value.forEach((entry, index) => {
    validateEntry(entry, `${path}[${index}]`, issues);
  });
}

function rejectPathFields(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      rejectPathFields(entry, `${path}[${index}]`, issues);
    });
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    if (/(?:path|root|filename)$/i.test(key) || key === "osuSource")
      add(issues, `${path}.${key}`, "Filesystem paths and filenames are private");
    rejectPathFields(entry, `${path}.${key}`, issues);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) add(issues, `${path}.${key}`, "Unexpected contract field");
  }
}

function isStableNoteRefLike(value: unknown): value is StableNoteRefV1 {
  return (
    isRecord(value) &&
    typeof value.sourceLine === "number" &&
    typeof value.column === "number" &&
    (value.kind === "normal" || value.kind === "long") &&
    typeof value.startMs === "number" &&
    typeof value.endMs === "number"
  );
}

function isGoldAnnotation(
  target: GoldAnnotationV1 | SilverPredictionV1,
): target is GoldAnnotationV1 {
  return "exemplarRoles" in target;
}

function validateGoldExemplarRolesWorkflow(
  annotation: GoldAnnotationV1,
  path: string,
  foundation: JudgmentFoundationV1,
  issues: ValidationIssue[],
): void {
  const labels = new Set(annotation.labels.map((label) => label.tagId));
  annotation.exemplarRoles.forEach((role, index) => {
    const rolePath = `${path}.exemplarRoles[${index}]`;
    const tag = foundation.tags.find((entry) => entry.id === role.tagId);
    if (!tag) {
      add(issues, `${rolePath}.tagId`, `Foundation does not define ${role.tagId}`);
    } else if (tag.status !== "active") {
      add(
        issues,
        `${rolePath}.tagId`,
        `Exemplar roles require an active tag; ${tag.id} is ${tag.status}`,
      );
    }

    if (role.kind === "counterexample" && labels.has(role.tagId)) {
      add(issues, rolePath, "Counterexample role cannot target a label on the same gold");
    }
    if (role.kind !== "counterexample" && !labels.has(role.tagId)) {
      add(issues, rolePath, "Strong and weak roles require the same tag label");
    }
  });
}

function collectIds(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map((entry) => (isRecord(entry) ? entry.id : undefined)) : [];
}

function sameNormalizedNotes(
  left: Pick<ManiaChart, "notes">["notes"],
  right: Pick<ManiaChart, "notes">["notes"],
): boolean {
  return (
    left.length === right.length &&
    left.every((note, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        note.sourceLine === other.sourceLine &&
        note.column === other.column &&
        note.kind === other.kind &&
        note.startTime === other.startTime &&
        note.endTime === other.endTime
      );
    })
  );
}

function literal(
  value: unknown,
  expected: string | number,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value !== expected) add(issues, path, `Expected ${JSON.stringify(expected)}`);
}

function oneOf(
  value: unknown,
  expected: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string" || !expected.includes(value)) {
    add(issues, path, `Expected one of ${expected.join(", ")}`);
  }
}

function string(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string") add(issues, path, "Expected a string");
}

function nonEmptyString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, path, "Expected a non-empty string");
  }
}

function stringArray(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, path, "Expected an array");
    return;
  }
  value.forEach((entry, index) => {
    nonEmptyString(entry, `${path}[${index}]`, issues);
  });
}

function finiteNumber(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    add(issues, path, "Expected a finite number");
  }
}

function integer(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Number.isInteger(value)) add(issues, path, "Expected an integer");
}

function positiveInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Number.isInteger(value) || (value as number) < 1)
    add(issues, path, "Expected a positive integer");
}

function nonNegativeInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    add(issues, path, "Expected a non-negative integer");
  }
}

function timestamp(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    add(issues, path, "Expected an ISO timestamp");
  }
}

function webUrl(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string") {
    add(issues, path, "Expected an HTTP(S) URL");
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      add(issues, path, "Expected an HTTP(S) URL");
    }
  } catch {
    add(issues, path, "Expected an HTTP(S) URL");
  }
}

function sha256(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    add(issues, path, "Expected a lowercase SHA-256 digest");
  }
}

function uuid(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    add(issues, path, "Expected a UUID");
  }
}

function unique(
  values: readonly unknown[],
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  if (new Set(values).size !== values.length) add(issues, path, `Expected unique ${label}s`);
}

function sameJson(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function failure<T>(path: string, message: string): ValidationResult<T> {
  return { ok: false, issues: [{ path, message }] };
}

function result<T>(value: Record<string, unknown>, issues: ValidationIssue[]): ValidationResult<T> {
  return issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues };
}

function assertValid<T>(result: ValidationResult<T>, heading: string): void {
  if (result.ok) return;
  throw new Error(
    `${heading}: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
