import { serializeCanonicalJson, serializeFoundationV1, sha256Hex } from "./canonical-json";
import type {
  AnnotationDocumentV1,
  FoundationRefV1,
  GoldAnnotationV1,
  SourceIdentityV1,
} from "./contracts";
import { DATASET_CONTRACT } from "./contracts";
import type {
  DatasetDirectory,
  DatasetDirectoryHandle,
  DatasetFileHandle,
} from "./dataset-directory";
import { hasMeaningfulDraft, type SessionStore } from "./session-store";

export interface ReleaseDurationStatistics {
  readonly maximumMs: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly minimumMs: number;
  readonly p90Ms: number;
  readonly totalMs: number;
}

export interface ReleaseManifestV1 {
  readonly annotationCount: number;
  readonly contract: "beatmap-lens-section-release";
  readonly datasetId: string;
  readonly documentCount: number;
  readonly durationDistribution: ReleaseDurationStatistics;
  readonly exportedAt: string;
  readonly foundationDigests: readonly FoundationRefV1[];
  readonly salienceCounts: Readonly<Record<"1" | "2", number>>;
  readonly sourceSha256s: readonly string[];
  readonly tagCounts: Readonly<Record<string, number>>;
  readonly version: 1;
}

export interface GoldReleaseRowV1 {
  readonly annotation: GoldAnnotationV1;
  readonly contract: "beatmap-lens-gold-section";
  readonly datasetId: string;
  readonly documentId: string;
  readonly source: SourceIdentityV1;
  readonly version: 1;
}

export interface FoundationCopy {
  readonly filename: string;
  readonly source: string;
}

export interface GoldReleaseArtifact {
  readonly foundations: readonly FoundationCopy[];
  readonly goldJsonl: string;
  readonly manifest: ReleaseManifestV1;
  readonly releaseJson: string;
}

export interface WrittenRelease extends GoldReleaseArtifact {
  readonly releaseId: string;
}

export function sameGoldReleaseArtifact(
  left: GoldReleaseArtifact,
  right: GoldReleaseArtifact,
): boolean {
  return (
    left.releaseJson === right.releaseJson &&
    left.goldJsonl === right.goldJsonl &&
    left.foundations.length === right.foundations.length &&
    left.foundations.every(
      (foundation, index) =>
        foundation.filename === right.foundations[index]?.filename &&
        foundation.source === right.foundations[index]?.source,
    )
  );
}

export async function buildGoldRelease(
  directory: DatasetDirectory,
  sessions: SessionStore,
  exportedAt = new Date().toISOString(),
): Promise<GoldReleaseArtifact> {
  const scanned = await directory.scanAnnotations();
  const blocked = scanned.find((entry) => entry.status !== "ok");
  if (blocked) {
    throw new TypeError(
      blocked.status === "readonly-future"
        ? `Cannot export unsupported annotation v${blocked.version}: ${blocked.filename}.`
        : `Cannot export an unreadable canonical annotation: ${blocked.filename}.`,
    );
  }

  const invalidComplete = scanned.find(
    (entry) =>
      entry.status === "ok" &&
      entry.document.reviewState === "complete" &&
      (entry.document.reviewNotes.some((note) => note.state === "open") ||
        entry.document.predictions.some((prediction) => prediction.reviewStatus === "pending")),
  );
  if (invalidComplete?.status === "ok") {
    throw new TypeError(
      `Cannot export an incompletely reviewed chart: ${invalidComplete.filename}.`,
    );
  }

  const documents = scanned
    .flatMap((entry) =>
      entry.status === "ok" && entry.document.reviewState === "complete" ? [entry.document] : [],
    )
    .sort((left, right) => left.source.sha256.localeCompare(right.source.sha256));
  await assertNoCompleteDraftBlockers(directory, sessions, documents);

  const rows = documents.flatMap((document) => releaseRows(directory.manifest.datasetId, document));
  const references = uniqueFoundationReferences(rows.map((row) => row.annotation.foundation));
  const foundations = await Promise.all(
    references.map(async (reference): Promise<FoundationCopy> => {
      const foundation = await directory.readFoundation(reference);
      const source = serializeFoundationV1(foundation);
      if ((await sha256Hex(source)) !== reference.sha256) {
        throw new TypeError("A release Foundation copy differs from its pinned digest.");
      }
      return {
        filename: `${reference.sha256}.judgment-foundation.v1.json`,
        source,
      };
    }),
  );
  const manifest = buildReleaseManifest(directory.manifest.datasetId, exportedAt, documents, rows);

  return {
    foundations,
    goldJsonl: rows.map(serializeJsonLine).join(""),
    manifest,
    releaseJson: serializeCanonicalJson(manifest),
  };
}

export async function writeGoldRelease(
  root: DatasetDirectoryHandle,
  artifact: GoldReleaseArtifact,
): Promise<WrittenRelease> {
  await assertReleaseDataset(root, artifact.manifest.datasetId);
  const digest = await sha256Hex(artifact.releaseJson);
  const timestamp = artifact.manifest.exportedAt.replace(/[^\d]/g, "").slice(0, 17);
  const releaseId = `${timestamp}-${digest.slice(0, 12)}`;
  const exportsDirectory = await root.getDirectoryHandle("exports");
  const releaseDirectory = await exportsDirectory.getDirectoryHandle(releaseId, { create: true });
  const foundationDirectory = await releaseDirectory.getDirectoryHandle("foundations", {
    create: true,
  });

  for (const foundation of artifact.foundations) {
    await writeTextFile(foundationDirectory, foundation.filename, foundation.source);
  }
  await writeTextFile(releaseDirectory, "gold-sections.v1.jsonl", artifact.goldJsonl);
  await writeTextFile(releaseDirectory, "release.json", artifact.releaseJson);

  return { ...artifact, releaseId };
}

async function assertNoCompleteDraftBlockers(
  directory: DatasetDirectory,
  sessions: SessionStore,
  documents: readonly AnnotationDocumentV1[],
): Promise<void> {
  const completeSources = new Set(documents.map((document) => document.source.sha256));
  const blockedSources = new Set(
    (await sessions.listDrafts(directory.manifest.datasetId))
      .filter(hasMeaningfulDraft)
      .flatMap((draft) => (completeSources.has(draft.sourceSha256) ? [draft.sourceSha256] : [])),
  );
  if (blockedSources.size === 0) return;

  const plural = blockedSources.size === 1 ? "" : "s";
  throw new TypeError(
    `Cannot export ${blockedSources.size} complete chart${plural} with uncommitted draft${plural}.`,
  );
}

async function assertReleaseDataset(
  root: DatasetDirectoryHandle,
  datasetId: string,
): Promise<void> {
  let value: unknown;
  try {
    const handle = await root.getFileHandle("dataset.json");
    const file = await handle.getFile();
    value = JSON.parse(await file.text());
  } catch (error) {
    throw new TypeError("Release target does not contain a readable dataset.json.", {
      cause: error,
    });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("contract" in value) ||
    value.contract !== DATASET_CONTRACT ||
    !("version" in value) ||
    value.version !== 1 ||
    !("datasetId" in value) ||
    value.datasetId !== datasetId
  ) {
    throw new TypeError("Release artifact dataset ID does not match its target directory.");
  }
}

function releaseRows(datasetId: string, document: AnnotationDocumentV1): GoldReleaseRowV1[] {
  const source = copySource(document.source);
  return document.annotations.map((annotation) => ({
    annotation: copyGoldAnnotation(annotation),
    contract: "beatmap-lens-gold-section",
    datasetId,
    documentId: document.documentId,
    source,
    version: 1,
  }));
}

function copySource(source: SourceIdentityV1): SourceIdentityV1 {
  return {
    artist: source.artist,
    ...(source.beatmapId === undefined ? {} : { beatmapId: source.beatmapId }),
    ...(source.beatmapSetId === undefined ? {} : { beatmapSetId: source.beatmapSetId }),
    byteLength: source.byteLength,
    creator: source.creator,
    difficulty: source.difficulty,
    keyCount: source.keyCount,
    normalizerId: source.normalizerId,
    noteCount: source.noteCount,
    osuFormatVersion: source.osuFormatVersion,
    sha256: source.sha256,
    title: source.title,
  };
}

function copyGoldAnnotation(annotation: GoldAnnotationV1): GoldAnnotationV1 {
  return {
    annotatorId: annotation.annotatorId,
    createdAt: annotation.createdAt,
    derivedFromPredictionIds: [...annotation.derivedFromPredictionIds],
    foundation: { ...annotation.foundation },
    id: annotation.id,
    ...(annotation.judgmentNote === undefined ? {} : { judgmentNote: annotation.judgmentNote }),
    exemplarRoles: annotation.exemplarRoles.map((role) => ({ ...role })),
    labels: annotation.labels.map((label) => ({
      salience: label.salience,
      tagId: label.tagId,
    })),
    noteRefs: annotation.noteRefs.map((note) => ({
      column: note.column,
      endMs: note.endMs,
      kind: note.kind,
      sourceLine: note.sourceLine,
      startMs: note.startMs,
    })),
    range: { endMs: annotation.range.endMs, startMs: annotation.range.startMs },
    updatedAt: annotation.updatedAt,
  };
}

function buildReleaseManifest(
  datasetId: string,
  exportedAt: string,
  documents: readonly AnnotationDocumentV1[],
  rows: readonly GoldReleaseRowV1[],
): ReleaseManifestV1 {
  const tagCounts: Record<string, number> = {};
  const salienceCounts: Record<"1" | "2", number> = { "1": 0, "2": 0 };
  const durations = rows.map(({ annotation }) => annotation.range.endMs - annotation.range.startMs);

  for (const { annotation } of rows) {
    for (const label of annotation.labels) {
      tagCounts[label.tagId] = (tagCounts[label.tagId] ?? 0) + 1;
      salienceCounts[label.salience] += 1;
    }
  }

  return {
    annotationCount: rows.length,
    contract: "beatmap-lens-section-release",
    datasetId,
    documentCount: documents.length,
    durationDistribution: durationStatistics(durations),
    exportedAt,
    foundationDigests: uniqueFoundationReferences(
      rows.map(({ annotation }) => annotation.foundation),
    ),
    salienceCounts,
    sourceSha256s: documents.map((document) => document.source.sha256),
    tagCounts: Object.fromEntries(
      Object.entries(tagCounts).sort(([left], [right]) => left.localeCompare(right)),
    ),
    version: 1,
  };
}

function durationStatistics(values: readonly number[]): ReleaseDurationStatistics {
  if (values.length === 0) {
    return { maximumMs: 0, meanMs: 0, medianMs: 0, minimumMs: 0, p90Ms: 0, totalMs: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const totalMs = sorted.reduce((sum, duration) => sum + duration, 0);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);

  return {
    maximumMs: sorted.at(-1) ?? 0,
    meanMs: totalMs / sorted.length,
    medianMs,
    minimumMs: sorted[0] ?? 0,
    p90Ms: sorted[Math.ceil(sorted.length * 0.9) - 1] ?? 0,
    totalMs,
  };
}

function uniqueFoundationReferences(
  values: readonly FoundationRefV1[],
): readonly FoundationRefV1[] {
  return [
    ...new Map(
      values.map((reference) => [
        reference.sha256,
        {
          foundationId: reference.foundationId,
          revision: reference.revision,
          sha256: reference.sha256,
        },
      ]),
    ).values(),
  ].sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function serializeJsonLine(value: unknown): string {
  const normalized = JSON.parse(serializeCanonicalJson(value)) as unknown;
  return `${JSON.stringify(normalized)}\n`;
}

async function writeTextFile(
  directory: DatasetDirectoryHandle,
  filename: string,
  source: string,
): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  await writeAndVerify(handle, source);
}

async function writeAndVerify(handle: DatasetFileHandle, source: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(source);
  await writable.close();
  if ((await (await handle.getFile()).text()) !== source) {
    throw new TypeError(`Release file ${handle.name} failed read-back verification.`);
  }
}
