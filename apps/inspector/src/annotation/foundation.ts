import { hashFoundationV1, type Sha256DigestFunction } from "./canonical-json";
import type {
  FoundationPoliciesV1,
  FoundationRefV1,
  FoundationTagV1,
  JudgmentFoundationV1,
} from "./contracts";
import { FOUNDATION_CONTRACT } from "./contracts";

export const FOUNDATION_POLICIES_V1: FoundationPoliciesV1 = {
  coordinates: "source-ms",
  rangeConvention: "half-open",
  datasetSemantics: "positive-only",
  salience: {
    1: "present-supporting-mixed-partial-or-transitional",
    2: "dominant-clear-diagnostic",
  },
  audioRole: "optional-context",
  catalogRole: "suggestion-only",
  explicitNoteEvidenceRequired: true,
  multiLabelAllowed: true,
  overlappingSectionsAllowed: true,
};

export interface FoundationTagSeedV1 {
  readonly id: string;
  readonly displayName: string;
}

export interface BootstrapFoundationInputV1 {
  readonly foundationId: string;
  readonly creatorId: string;
  readonly createdAt: string;
  readonly catalogTags: readonly (string | FoundationTagSeedV1)[];
}

export interface CreateActiveFoundationTagInputV1 {
  readonly tagId: string;
  readonly displayName: string;
  readonly definition: string;
  readonly inclusionCues: readonly string[];
  readonly exclusionCues?: readonly string[];
  readonly aliases?: readonly string[];
  readonly salienceClarification?: string;
}

export interface FoundationRevisionMetadataV1 {
  readonly creatorId: string;
  readonly createdAt: string;
}

export function bootstrapFoundationV1(input: BootstrapFoundationInputV1): JudgmentFoundationV1 {
  const catalogTagIds = input.catalogTags.map((seed) =>
    typeof seed === "string" ? canonicalTagId(seed) : seed.id,
  );
  catalogTagIds.forEach(assertCanonicalTagId);
  assertUnique(catalogTagIds, "catalog tag ID");

  return {
    contract: FOUNDATION_CONTRACT,
    version: 1,
    foundationId: input.foundationId,
    revision: 1,
    language: "zh-CN",
    creatorId: input.creatorId,
    createdAt: input.createdAt,
    policies: FOUNDATION_POLICIES_V1,
    tags: [],
  };
}

export async function createActiveFoundationTagV1(
  foundation: JudgmentFoundationV1,
  input: CreateActiveFoundationTagInputV1,
  revision: FoundationRevisionMetadataV1,
  digest?: Sha256DigestFunction,
): Promise<JudgmentFoundationV1> {
  assertCanonicalTagId(input.tagId);
  const displayName = input.displayName.trim();
  const definition = input.definition.trim();
  const inclusionCues = cleanNonEmpty(input.inclusionCues);
  if (!displayName) throw new Error("Active tag creation requires a display name");
  if (!definition) throw new Error("Tag activation requires a definition");
  if (inclusionCues.length === 0) throw new Error("Tag activation requires an inclusion cue");

  const existing = foundation.tags.find((tag) => tag.id === input.tagId);
  if (existing) {
    if (existing.status === "retired")
      throw new Error(`Retired tag ${input.tagId} cannot be reused`);
    throw new Error(`Tag ${input.tagId} is already active`);
  }

  const exclusionCues = uniqueNonEmpty(input.exclusionCues ?? []);
  const salienceClarification = input.salienceClarification?.trim();
  const activated: FoundationTagV1 = {
    id: input.tagId,
    displayName,
    status: "active",
    definition,
    inclusionCues: uniqueNonEmpty(inclusionCues),
    ...(exclusionCues.length > 0 ? { exclusionCues } : {}),
    aliases: uniqueNonEmpty(input.aliases ?? []),
    ...(salienceClarification ? { salienceClarification } : {}),
  };

  return {
    ...foundation,
    revision: foundation.revision + 1,
    parentSha256: await hashFoundationV1(foundation, digest),
    creatorId: revision.creatorId,
    createdAt: revision.createdAt,
    tags: [...foundation.tags, activated],
  };
}

export type ActivateFoundationTagInputV1 = CreateActiveFoundationTagInputV1;
export const activateFoundationTagV1 = createActiveFoundationTagV1;

export async function foundationRefV1(
  foundation: JudgmentFoundationV1,
  digest?: Sha256DigestFunction,
): Promise<FoundationRefV1> {
  return {
    foundationId: foundation.foundationId,
    revision: foundation.revision,
    sha256: await hashFoundationV1(foundation, digest),
  };
}

export function findFoundationTagV1(
  foundation: JudgmentFoundationV1,
  tagId: string,
): FoundationTagV1 | undefined {
  return foundation.tags.find((tag) => tag.id === tagId);
}

export function assertActiveFoundationTagV1(
  foundation: JudgmentFoundationV1,
  tagId: string,
): FoundationTagV1 {
  const tag = findFoundationTagV1(foundation, tagId);
  if (!tag) throw new Error(`Foundation does not define tag ${tagId}`);
  if (tag.status !== "active") throw new Error(`Tag ${tagId} is ${tag.status}, not active`);
  return tag;
}

export function canonicalTagId(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isCanonicalTagId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export const activateTagV1 = createActiveFoundationTagV1;

function assertCanonicalTagId(value: string): void {
  if (!isCanonicalTagId(value)) {
    throw new Error(`Tag ID ${JSON.stringify(value)} must be lowercase kebab-case`);
  }
}

function cleanNonEmpty(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(cleanNonEmpty(values))];
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
