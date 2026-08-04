import type {
  AnnotationDocumentV1,
  FoundationExemplarV1,
  GoldAnnotationV1,
  JudgmentFoundationV1,
  ReviewNoteV1,
  SilverPredictionV1,
  StableNoteRefV1,
} from "./contracts";

export type Sha256DigestFunction = (
  algorithm: AlgorithmIdentifier,
  data: BufferSource,
) => Promise<ArrayBuffer>;

const encoder = new TextEncoder();

export function serializeCanonicalJson(value: unknown): string {
  return `${JSON.stringify(normalizeJson(value), undefined, 2)}\n`;
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(serializeCanonicalJson(value));
}

export async function sha256Hex(
  value: string | Uint8Array,
  digest: Sha256DigestFunction = (algorithm, data) =>
    globalThis.crypto.subtle.digest(algorithm, data),
): Promise<string> {
  const source = typeof value === "string" ? encoder.encode(value) : value;
  const bytes = new Uint8Array(source);
  const result = await digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeFoundationV1(foundation: JudgmentFoundationV1): string {
  return serializeCanonicalJson(sortFoundation(foundation));
}

export function foundationBytesV1(foundation: JudgmentFoundationV1): Uint8Array {
  return encoder.encode(serializeFoundationV1(foundation));
}

export async function hashFoundationV1(
  foundation: JudgmentFoundationV1,
  digest?: Sha256DigestFunction,
): Promise<string> {
  return sha256Hex(foundationBytesV1(foundation), digest);
}

export function serializeAnnotationDocumentV1(document: AnnotationDocumentV1): string {
  return serializeCanonicalJson(sortAnnotationDocument(document));
}

export function annotationDocumentBytesV1(document: AnnotationDocumentV1): Uint8Array {
  return encoder.encode(serializeAnnotationDocumentV1(document));
}

export function compareStableNoteRefs(left: StableNoteRefV1, right: StableNoteRefV1): number {
  return (
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    left.column - right.column ||
    left.sourceLine - right.sourceLine ||
    compareText(left.kind, right.kind) ||
    compareText(left.objectSha256, right.objectSha256)
  );
}

function sortFoundation(foundation: JudgmentFoundationV1): JudgmentFoundationV1 {
  return {
    ...foundation,
    tags: [...foundation.tags]
      .sort((left, right) => compareText(left.id, right.id))
      .map((tag) => ({
        ...tag,
        inclusionCues: sortedStrings(tag.inclusionCues),
        ...(tag.exclusionCues ? { exclusionCues: sortedStrings(tag.exclusionCues) } : {}),
        aliases: sortedStrings(tag.aliases),
        exemplars: [...tag.exemplars].sort(compareExemplars),
      })),
  };
}

function sortAnnotationDocument(document: AnnotationDocumentV1): AnnotationDocumentV1 {
  return {
    ...document,
    seedContext: {
      ...document.seedContext,
      suggestedTags: sortedStrings(document.seedContext.suggestedTags),
    },
    annotations: [...document.annotations].sort(compareTargets).map(sortGoldAnnotation),
    predictions: [...document.predictions].sort(compareTargets).map(sortSilverPrediction),
    reviewNotes: [...document.reviewNotes].sort(compareReviewNotes).map(sortReviewNote),
  };
}

function sortGoldAnnotation(annotation: GoldAnnotationV1): GoldAnnotationV1 {
  return {
    ...annotation,
    noteRefs: [...annotation.noteRefs].sort(compareStableNoteRefs),
    labels: [...annotation.labels].sort((left, right) => compareText(left.tagId, right.tagId)),
    derivedFromPredictionIds: sortedStrings(annotation.derivedFromPredictionIds),
  };
}

function sortSilverPrediction(prediction: SilverPredictionV1): SilverPredictionV1 {
  return {
    ...prediction,
    noteRefs: [...prediction.noteRefs].sort(compareStableNoteRefs),
    labels: [...prediction.labels].sort((left, right) => compareText(left.tagId, right.tagId)),
  };
}

function sortReviewNote(note: ReviewNoteV1): ReviewNoteV1 {
  return {
    ...note,
    ...(note.noteRefs ? { noteRefs: [...note.noteRefs].sort(compareStableNoteRefs) } : {}),
  };
}

function compareTargets(
  left: Pick<GoldAnnotationV1, "id" | "range">,
  right: Pick<GoldAnnotationV1, "id" | "range">,
): number {
  return (
    left.range.startMs - right.range.startMs ||
    left.range.endMs - right.range.endMs ||
    compareText(left.id, right.id)
  );
}

function compareReviewNotes(left: ReviewNoteV1, right: ReviewNoteV1): number {
  return (
    (left.range?.startMs ?? Number.POSITIVE_INFINITY) -
      (right.range?.startMs ?? Number.POSITIVE_INFINITY) ||
    (left.range?.endMs ?? Number.POSITIVE_INFINITY) -
      (right.range?.endMs ?? Number.POSITIVE_INFINITY) ||
    compareText(left.id, right.id)
  );
}

function compareExemplars(left: FoundationExemplarV1, right: FoundationExemplarV1): number {
  return (
    compareText(left.kind, right.kind) ||
    compareText(left.sourceSha256, right.sourceSha256) ||
    compareText(left.annotationId, right.annotationId)
  );
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return value;
  }

  if (Array.isArray(value)) return value.map(normalizeJson);

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }

  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}
