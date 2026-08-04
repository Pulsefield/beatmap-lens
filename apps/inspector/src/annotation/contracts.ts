export const DATASET_CONTRACT = "beatmap-lens-section-dataset" as const;
export const FOUNDATION_CONTRACT = "beatmap-lens-judgment-foundation" as const;
export const ANNOTATION_CONTRACT = "beatmap-lens-section-annotations" as const;
export const ANNOTATION_CONTRACT_VERSION = 1 as const;

export type Sha256Digest = string;
export type TagStatusV1 = "candidate" | "active" | "retired";
export type SalienceV1 = 1 | 2;

export interface FoundationRefV1 {
  readonly foundationId: string;
  readonly revision: number;
  readonly sha256: Sha256Digest;
}

export interface DatasetCatalogSourceV1 {
  readonly url: string;
  readonly csvSha256: Sha256Digest;
}

export interface DatasetManifestV1 {
  readonly contract: typeof DATASET_CONTRACT;
  readonly version: typeof ANNOTATION_CONTRACT_VERSION;
  readonly datasetId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentFoundation: FoundationRefV1;
  readonly catalogSources: readonly DatasetCatalogSourceV1[];
  readonly annotationContractVersion: typeof ANNOTATION_CONTRACT_VERSION;
}

export interface SourceIdentityV1 {
  readonly sha256: Sha256Digest;
  readonly byteLength: number;
  readonly osuFormatVersion: number;
  readonly beatmapId?: number;
  readonly beatmapSetId?: number;
  readonly title: string;
  readonly artist: string;
  readonly creator: string;
  readonly difficulty: string;
  readonly keyCount: number;
  readonly noteCount: number;
  readonly normalizerId: "beatmap-lens-mania-v1";
}

export interface StableNoteRefV1 {
  readonly sourceLine: number;
  readonly objectSha256: Sha256Digest;
  readonly column: number;
  readonly kind: "normal" | "long";
  readonly startMs: number;
  readonly endMs: number;
}

export interface TimeRangeV1 {
  readonly startMs: number;
  readonly endMs: number;
}

export interface FoundationPoliciesV1 {
  readonly coordinates: "source-ms";
  readonly rangeConvention: "half-open";
  readonly datasetSemantics: "positive-only";
  readonly salience: {
    readonly 1: "present-supporting-mixed-partial-or-transitional";
    readonly 2: "dominant-clear-diagnostic";
  };
  readonly audioRole: "optional-context";
  readonly catalogRole: "suggestion-only";
  readonly explicitNoteEvidenceRequired: true;
  readonly multiLabelAllowed: true;
  readonly overlappingSectionsAllowed: true;
}

export type FoundationExemplarKindV1 = "strong" | "weak" | "counterexample";

export interface FoundationExemplarV1 {
  readonly kind: FoundationExemplarKindV1;
  readonly sourceSha256: Sha256Digest;
  readonly annotationId: string;
}

export interface FoundationTagV1 {
  readonly id: string;
  readonly displayName: string;
  readonly status: TagStatusV1;
  readonly definition: string;
  readonly inclusionCues: readonly string[];
  readonly exclusionCues?: readonly string[];
  readonly aliases: readonly string[];
  readonly salienceClarification?: string;
  readonly exemplars: readonly FoundationExemplarV1[];
}

export interface JudgmentFoundationV1 {
  readonly contract: typeof FOUNDATION_CONTRACT;
  readonly version: typeof ANNOTATION_CONTRACT_VERSION;
  readonly foundationId: string;
  readonly revision: number;
  readonly parentSha256?: Sha256Digest;
  readonly language: "zh-CN";
  readonly creatorId: string;
  readonly createdAt: string;
  readonly policies: FoundationPoliciesV1;
  readonly tags: readonly FoundationTagV1[];
}

export interface AnnotationLabelV1 {
  readonly tagId: string;
  readonly salience: SalienceV1;
}

export interface GoldAnnotationV1 {
  readonly id: string;
  readonly range: TimeRangeV1;
  readonly noteRefs: readonly StableNoteRefV1[];
  readonly labels: readonly AnnotationLabelV1[];
  readonly foundation: FoundationRefV1;
  readonly annotatorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly judgmentNote?: string;
  readonly derivedFromPredictionIds: readonly string[];
}

export type PredictionReviewStatusV1 = "pending" | "reviewed" | "rejected";

export interface SilverPredictionV1 {
  readonly id: string;
  readonly range: TimeRangeV1;
  readonly noteRefs: readonly StableNoteRefV1[];
  readonly labels: readonly AnnotationLabelV1[];
  readonly foundation: FoundationRefV1;
  readonly producerId: string;
  readonly skillVersion: string;
  readonly modelVersion: string;
  readonly confidence?: number;
  readonly reviewStatus: PredictionReviewStatusV1;
  readonly resultingGoldAnnotationId?: string;
  readonly createdAt: string;
}

export type ReviewNoteStateV1 = "open" | "resolved";

export interface ReviewNoteV1 {
  readonly id: string;
  readonly range?: TimeRangeV1;
  readonly noteRefs?: readonly StableNoteRefV1[];
  readonly text: string;
  readonly state: ReviewNoteStateV1;
  readonly createdAt: string;
  readonly resultingFoundation?: FoundationRefV1;
  readonly resultingGoldAnnotationId?: string;
}

export interface AnnotationSeedContextV1 {
  readonly catalogSha256: Sha256Digest;
  readonly suggestedTags: readonly string[];
}

export interface AnnotationDocumentV1 {
  readonly contract: typeof ANNOTATION_CONTRACT;
  readonly version: typeof ANNOTATION_CONTRACT_VERSION;
  readonly documentId: string;
  readonly source: SourceIdentityV1;
  readonly seedContext: AnnotationSeedContextV1;
  readonly reviewState: "in-progress" | "complete";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly annotations: readonly GoldAnnotationV1[];
  readonly predictions: readonly SilverPredictionV1[];
  readonly reviewNotes: readonly ReviewNoteV1[];
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
