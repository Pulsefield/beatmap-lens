import {
  annotationDocumentBytesV1,
  canonicalJsonBytes,
  foundationBytesV1,
  serializeAnnotationDocumentV1,
  serializeCanonicalJson,
  serializeFoundationV1,
  sha256Hex,
} from "./canonical-json";
import {
  ANNOTATION_CONTRACT,
  ANNOTATION_CONTRACT_VERSION,
  type AnnotationDocumentV1,
  DATASET_CONTRACT,
  type DatasetCatalogSourceV1,
  type DatasetManifestV1,
  type FoundationRefV1,
  type JudgmentFoundationV1,
} from "./contracts";
import type { AnnotationDraft, DraftBaseVersion, SessionStore } from "./session-store";
import {
  type AnnotationWorkflowValidationContextV1,
  assertAnnotationDocumentV1,
  assertAnnotationWorkflowV1,
  assertDatasetManifestV1,
  assertJudgmentFoundationV1,
  validateCompatibleFoundationRevisionV1,
} from "./validation";

export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface WritableFileLike {
  close(): Promise<void>;
  write(data: string | Uint8Array): Promise<void>;
}

export interface DatasetFileHandle {
  readonly kind: "file";
  readonly name: string;
  createWritable(): Promise<WritableFileLike>;
  getFile(): Promise<FileLike>;
}

export type DatasetHandle = DatasetDirectoryHandle | DatasetFileHandle;

export interface DatasetDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterableIterator<[string, DatasetHandle]>;
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<DatasetDirectoryHandle>;
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<DatasetFileHandle>;
}

export interface StoredAnnotation {
  readonly document: AnnotationDocumentV1;
  readonly version: DraftBaseVersion;
}

export type AnnotationSaveContext = Omit<AnnotationWorkflowValidationContextV1, "foundations">;

export interface AnnotationScanSuccess extends StoredAnnotation {
  readonly filename: string;
  readonly status: "ok";
}

export interface AnnotationScanError {
  readonly error: Error;
  readonly filename: string;
  readonly status: "error";
}

export interface FutureAnnotationIdentity {
  readonly byteLength: number;
  readonly sha256: string;
}

export interface AnnotationScanFuture {
  readonly filename: string;
  readonly revision: number;
  readonly source: FutureAnnotationIdentity;
  readonly status: "readonly-future";
  readonly version: number;
}

export type AnnotationScanEntry =
  | AnnotationScanError
  | AnnotationScanFuture
  | AnnotationScanSuccess;

export type SaveAnnotationResult =
  | {
      readonly document: AnnotationDocumentV1;
      readonly status: "saved";
      readonly version: DraftBaseVersion;
    }
  | {
      readonly actual: DraftBaseVersion | null;
      readonly status: "conflict";
    };

export interface CreateDatasetOptions {
  readonly catalogSources: readonly DatasetCatalogSourceV1[];
  readonly createId?: () => string;
  readonly datasetId?: string;
  readonly foundation: JudgmentFoundationV1;
  readonly name: string;
  readonly now?: () => string;
}

export class DatasetWriteError extends Error {
  override readonly name = "DatasetWriteError";
}

export class ReadonlyFutureVersionError extends Error {
  override readonly name = "ReadonlyFutureVersionError";
}

export interface FutureDatasetManifestSummary {
  readonly contract: typeof DATASET_CONTRACT;
  readonly datasetId?: string;
  readonly name?: string;
  readonly version: number;
}

export class ReadonlyFutureDatasetDirectory {
  readonly #root: DatasetDirectoryHandle;
  readonly mode = "readonly-future";
  readonly manifest: FutureDatasetManifestSummary;

  constructor(root: DatasetDirectoryHandle, manifest: FutureDatasetManifestSummary) {
    this.#root = root;
    this.manifest = manifest;
  }

  async scanAnnotations(): Promise<readonly AnnotationScanEntry[]> {
    const directory = await this.#root.getDirectoryHandle("annotations");
    return scanAnnotationFiles(directory);
  }
}

export interface DatasetDirectory {
  readonly manifest: DatasetManifestV1;
  readAnnotation(sourceSha256: string): Promise<StoredAnnotation | null>;
  readFoundation(reference: FoundationRefV1): Promise<JudgmentFoundationV1>;
  saveAnnotation(
    document: AnnotationDocumentV1,
    base: DraftBaseVersion | null,
    context: AnnotationSaveContext,
  ): Promise<SaveAnnotationResult>;
  scanAnnotations(): Promise<readonly AnnotationScanEntry[]>;
  setCurrentFoundation(foundation: JudgmentFoundationV1): Promise<FoundationRefV1>;
  writeFoundation(foundation: JudgmentFoundationV1): Promise<FoundationRefV1>;
}

export class FileSystemDatasetDirectory implements DatasetDirectory {
  #manifest: DatasetManifestV1;
  readonly #now: () => string;
  readonly mode = "read-write-v1";
  readonly root: DatasetDirectoryHandle;

  constructor(
    root: DatasetDirectoryHandle,
    manifest: DatasetManifestV1,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.root = root;
    this.#manifest = manifest;
    this.#now = now;
  }

  get manifest(): DatasetManifestV1 {
    return this.#manifest;
  }

  async readAnnotation(sourceSha256: string): Promise<StoredAnnotation | null> {
    assertSha256(sourceSha256, "source SHA-256");
    const directory = await this.root.getDirectoryHandle("annotations");
    await assertNoFutureAnnotation(directory, sourceSha256);
    const filename = annotationFilename(sourceSha256);
    const file = await optionalFile(directory, filename);
    if (!file) return null;

    const stored = await parseStoredAnnotation(file);
    if (stored.document.source.sha256 !== sourceSha256) {
      throw new TypeError(`Annotation source hash does not match ${filename}.`);
    }
    await this.#verifyFoundationPins(stored.document);
    return stored;
  }

  async readFoundation(reference: FoundationRefV1): Promise<JudgmentFoundationV1> {
    const directory = await this.root.getDirectoryHandle("foundations");
    const file = await directory.getFileHandle(foundationFilename(reference.sha256));
    const bytes = await readBytes(file);
    const digest = await sha256Hex(bytes);
    if (digest !== reference.sha256) {
      throw new TypeError("Foundation snapshot digest does not match its reference.");
    }

    const source = new TextDecoder().decode(bytes);
    const value: unknown = JSON.parse(source);
    assertJudgmentFoundationV1(value);
    if (
      value.foundationId !== reference.foundationId ||
      value.revision !== reference.revision ||
      serializeFoundationV1(value) !== source
    ) {
      throw new TypeError("Foundation snapshot does not match its pinned identity.");
    }
    return value;
  }

  async saveAnnotation(
    document: AnnotationDocumentV1,
    base: DraftBaseVersion | null,
    context: AnnotationSaveContext,
  ): Promise<SaveAnnotationResult> {
    assertAnnotationDocumentV1(document);
    const foundations = await this.#foundationSnapshots(document);
    await assertAnnotationWorkflowV1(document, { ...context, foundations });

    const directory = await this.root.getDirectoryHandle("annotations");
    await assertNoFutureAnnotation(directory, document.source.sha256);
    const filename = annotationFilename(document.source.sha256);
    const currentFile = await optionalFile(directory, filename);
    const current = currentFile ? await parseStoredAnnotation(currentFile) : null;
    if (current && current.document.source.sha256 !== document.source.sha256) {
      throw new TypeError("Existing annotation filename and source identity disagree.");
    }

    if (!sameVersion(current?.version ?? null, base)) {
      return { actual: current?.version ?? null, status: "conflict" };
    }
    if (current) assertStableDocumentIdentity(current.document, document);

    const revision = (current?.document.revision ?? 0) + 1;
    const savedDocument: AnnotationDocumentV1 = {
      ...document,
      revision,
      updatedAt: this.#now(),
    };
    assertAnnotationDocumentV1(savedDocument);
    const bytes = annotationDocumentBytesV1(savedDocument);

    try {
      const handle = await directory.getFileHandle(filename, { create: true });
      const readBack = await writeAndReadBack(handle, bytes);
      const readBackSource = new TextDecoder().decode(readBack);
      const parsed: unknown = JSON.parse(readBackSource);
      assertAnnotationDocumentV1(parsed);
      if (
        parsed.source.sha256 !== document.source.sha256 ||
        serializeAnnotationDocumentV1(parsed) !== readBackSource
      ) {
        throw new TypeError("Annotation read-back is not the canonical document that was written.");
      }

      await this.#verifyFoundationPins(parsed);
      const sha256 = await sha256Hex(readBack);
      return {
        document: parsed,
        status: "saved",
        version: { revision: parsed.revision, sha256 },
      };
    } catch (error) {
      throw new DatasetWriteError(`Could not save and verify ${filename}.`, { cause: error });
    }
  }

  async scanAnnotations(): Promise<readonly AnnotationScanEntry[]> {
    const directory = await this.root.getDirectoryHandle("annotations");
    return scanAnnotationFiles(directory, (document) => this.#verifyFoundationPins(document));
  }

  async setCurrentFoundation(foundation: JudgmentFoundationV1): Promise<FoundationRefV1> {
    const reference = await this.writeFoundation(foundation);
    const current = await readDatasetManifest(this.root);
    await this.#assertFoundationCompatibleWith(current, foundation, reference.sha256);
    const next: DatasetManifestV1 = {
      ...current,
      currentFoundation: reference,
      updatedAt: this.#now(),
    };
    assertDatasetManifestV1(next);

    const handle = await this.root.getFileHandle("dataset.json");
    try {
      const readBack = await writeAndReadBack(handle, canonicalJsonBytes(next));
      const source = new TextDecoder().decode(readBack);
      const parsed: unknown = JSON.parse(source);
      assertDatasetManifestV1(parsed);
      if (
        serializeCanonicalJson(parsed) !== source ||
        parsed.currentFoundation.sha256 !== reference.sha256
      ) {
        throw new TypeError("Dataset manifest read-back did not pin the new Foundation.");
      }
      this.#manifest = parsed;
      return reference;
    } catch (error) {
      throw new DatasetWriteError("Could not update and verify dataset.json.", { cause: error });
    }
  }

  async writeFoundation(foundation: JudgmentFoundationV1): Promise<FoundationRefV1> {
    assertJudgmentFoundationV1(foundation);
    const bytes = foundationBytesV1(foundation);
    const sha256 = await sha256Hex(bytes);
    const reference: FoundationRefV1 = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256,
    };
    const directory = await this.root.getDirectoryHandle("foundations");
    const filename = foundationFilename(sha256);
    const existing = await optionalFile(directory, filename);
    const datasetFile = await optionalFile(this.root, "dataset.json");
    if (datasetFile) {
      const currentManifest = await readDatasetManifest(this.root);
      await this.#assertFoundationCompatibleWith(currentManifest, foundation, sha256);
    }
    if (existing) {
      const existingBytes = await readBytes(existing);
      if (!equalBytes(existingBytes, bytes)) {
        throw new TypeError("An immutable Foundation filename already contains different bytes.");
      }
      return reference;
    }

    try {
      const handle = await directory.getFileHandle(filename, { create: true });
      const readBack = await writeAndReadBack(handle, bytes);
      if ((await sha256Hex(readBack)) !== sha256) {
        throw new TypeError("Foundation read-back digest differs from the snapshot filename.");
      }
      const value: unknown = JSON.parse(new TextDecoder().decode(readBack));
      assertJudgmentFoundationV1(value);
      return reference;
    } catch (error) {
      throw new DatasetWriteError(`Could not save and verify ${filename}.`, { cause: error });
    }
  }

  async #foundationSnapshots(
    document: AnnotationDocumentV1,
  ): Promise<AnnotationWorkflowValidationContextV1["foundations"]> {
    const foundations = new Map<string, JudgmentFoundationV1>();
    for (const annotation of document.annotations) {
      const foundation = await readPinnedFoundation(this, foundations, annotation.foundation);
      const tags = new Map(foundation.tags.map((tag) => [tag.id, tag.status]));
      for (const label of annotation.labels) {
        if (tags.get(label.tagId) !== "active") {
          throw new TypeError(`Gold label ${label.tagId} is not active in its Foundation.`);
        }
      }
    }
    for (const prediction of document.predictions) {
      await readPinnedFoundation(this, foundations, prediction.foundation);
    }
    for (const note of document.reviewNotes) {
      if (note.resultingFoundation) {
        await readPinnedFoundation(this, foundations, note.resultingFoundation);
      }
    }
    return [...foundations.entries()].map(([sha256, foundation]) => ({ foundation, sha256 }));
  }

  async #verifyFoundationPins(document: AnnotationDocumentV1): Promise<void> {
    await this.#foundationSnapshots(document);
  }

  async #assertFoundationCompatibleWith(
    manifest: DatasetManifestV1,
    foundation: JudgmentFoundationV1,
    sha256: string,
  ): Promise<void> {
    if (
      manifest.currentFoundation.sha256 === sha256 &&
      manifest.currentFoundation.foundationId === foundation.foundationId &&
      manifest.currentFoundation.revision === foundation.revision
    ) {
      return;
    }
    const current = await this.readFoundation(manifest.currentFoundation);
    const issues = validateCompatibleFoundationRevisionV1(
      current,
      foundation,
      manifest.currentFoundation.sha256,
    );
    if (issues.length > 0) {
      throw new TypeError(
        `Incompatible Foundation revision: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
      );
    }
  }
}

export async function createDatasetDirectory(
  root: DatasetDirectoryHandle,
  options: CreateDatasetOptions,
): Promise<FileSystemDatasetDirectory> {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => crypto.randomUUID());
  if (await optionalFile(root, "dataset.json")) {
    throw new TypeError("The selected directory already contains dataset.json; open it instead.");
  }
  await root.getDirectoryHandle("annotations", { create: true });
  await root.getDirectoryHandle("exports", { create: true });
  await root.getDirectoryHandle("foundations", { create: true });

  const createdAt = now();
  const placeholder: DatasetManifestV1 = {
    annotationContractVersion: ANNOTATION_CONTRACT_VERSION,
    catalogSources: options.catalogSources,
    contract: DATASET_CONTRACT,
    createdAt,
    currentFoundation: {
      foundationId: options.foundation.foundationId,
      revision: options.foundation.revision,
      sha256: "0".repeat(64),
    },
    datasetId: options.datasetId ?? createId(),
    name: options.name,
    updatedAt: createdAt,
    version: ANNOTATION_CONTRACT_VERSION,
  };
  assertDatasetManifestV1(placeholder);
  const directory = new FileSystemDatasetDirectory(root, placeholder, now);
  const currentFoundation = await directory.writeFoundation(options.foundation);
  const manifest: DatasetManifestV1 = { ...placeholder, currentFoundation };
  assertDatasetManifestV1(manifest);

  const datasetFile = await root.getFileHandle("dataset.json", { create: true });
  try {
    const readBack = await writeAndReadBack(datasetFile, canonicalJsonBytes(manifest));
    const parsedSource = new TextDecoder().decode(readBack);
    const parsed: unknown = JSON.parse(parsedSource);
    assertDatasetManifestV1(parsed);
    if (serializeCanonicalJson(parsed) !== parsedSource) {
      throw new TypeError("dataset.json read-back is not canonical.");
    }
    return new FileSystemDatasetDirectory(root, parsed, now);
  } catch (error) {
    throw new DatasetWriteError("Could not create and verify dataset.json.", { cause: error });
  }
}

export async function openDatasetDirectory(
  root: DatasetDirectoryHandle,
  now?: () => string,
): Promise<FileSystemDatasetDirectory> {
  await root.getDirectoryHandle("annotations");
  await root.getDirectoryHandle("exports");
  await root.getDirectoryHandle("foundations");
  const manifest = await readDatasetManifest(root);
  const directory = new FileSystemDatasetDirectory(root, manifest, now);
  await directory.readFoundation(manifest.currentFoundation);
  return directory;
}

export async function openDatasetDirectoryAnyVersion(
  root: DatasetDirectoryHandle,
  now?: () => string,
): Promise<FileSystemDatasetDirectory | ReadonlyFutureDatasetDirectory> {
  const source = await readDatasetManifestSource(root);
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || value.contract !== DATASET_CONTRACT) {
    throw new TypeError("Invalid dataset manifest contract.");
  }
  if (value.version === ANNOTATION_CONTRACT_VERSION) {
    return openDatasetDirectory(root, now);
  }
  if (!Number.isInteger(value.version) || (value.version as number) <= 1) {
    throw new TypeError("Invalid dataset manifest version.");
  }

  return new ReadonlyFutureDatasetDirectory(root, {
    contract: DATASET_CONTRACT,
    ...(typeof value.datasetId === "string" ? { datasetId: value.datasetId } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    version: value.version as number,
  });
}

export async function saveDraftAnnotation(
  directory: DatasetDirectory,
  sessions: SessionStore,
  document: AnnotationDocumentV1,
  context: AnnotationSaveContext,
): Promise<SaveAnnotationResult> {
  const draft = await sessions.getDraft(directory.manifest.datasetId, document.source.sha256);
  if (!draft) {
    throw new TypeError("Cannot save an annotation without its draft journal.");
  }
  assertDraftIdentity(draft, directory.manifest.datasetId, document.source.sha256);

  const result = await directory.saveAnnotation(document, draft.base, {
    ...context,
    hasUncommittedDraft: context.hasUncommittedDraft === true || hasMeaningfulEditorState(draft),
  });
  if (result.status === "saved") {
    await sessions.deleteDraft(directory.manifest.datasetId, document.source.sha256);
  }
  return result;
}

const ANNOTATION_FILENAME = /^([a-f\d]{64})\.section-annotations\.v([1-9]\d*)\.json$/;

function annotationFilename(sourceSha256: string): string {
  return `${sourceSha256}.section-annotations.v1.json`;
}

function foundationFilename(sha256: string): string {
  assertSha256(sha256, "Foundation SHA-256");
  return `${sha256}.judgment-foundation.v1.json`;
}

async function readDatasetManifest(root: DatasetDirectoryHandle): Promise<DatasetManifestV1> {
  const source = await readDatasetManifestSource(root);
  const value: unknown = JSON.parse(source);
  assertDatasetManifestV1(value);
  if (serializeCanonicalJson(value) !== source) {
    throw new TypeError("dataset.json is not canonical.");
  }
  return value;
}

async function readDatasetManifestSource(root: DatasetDirectoryHandle): Promise<string> {
  const handle = await root.getFileHandle("dataset.json");
  return (await handle.getFile()).text();
}

async function scanAnnotationFiles(
  directory: DatasetDirectoryHandle,
  verifyV1?: (document: AnnotationDocumentV1) => Promise<void>,
): Promise<readonly AnnotationScanEntry[]> {
  const entries: AnnotationScanEntry[] = [];
  for await (const [filename, handle] of directory.entries()) {
    const match = filename.match(ANNOTATION_FILENAME);
    if (handle.kind !== "file" || !match) continue;
    try {
      const version = Number(match[2]);
      if (version > 1) {
        entries.push(await parseFutureAnnotation(handle, filename, version));
        continue;
      }

      const stored = await parseStoredAnnotation(handle);
      if (stored.document.source.sha256 !== match[1]) {
        throw new TypeError("Annotation filename and source identity disagree.");
      }
      await verifyV1?.(stored.document);
      entries.push({ ...stored, filename, status: "ok" });
    } catch (error) {
      entries.push({ error: toError(error), filename, status: "error" });
    }
  }
  return entries.sort((left, right) => left.filename.localeCompare(right.filename));
}

async function parseFutureAnnotation(
  handle: DatasetFileHandle,
  filename: string,
  filenameVersion: number,
): Promise<AnnotationScanFuture> {
  const value: unknown = JSON.parse(await (await handle.getFile()).text());
  const sourceSha256 = filename.slice(0, 64);
  if (
    !isRecord(value) ||
    value.contract !== ANNOTATION_CONTRACT ||
    value.version !== filenameVersion ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isRecord(value.source) ||
    value.source.sha256 !== sourceSha256 ||
    !Number.isInteger(value.source.byteLength) ||
    (value.source.byteLength as number) < 0
  ) {
    throw new TypeError("Future annotation identity could not be read safely.");
  }
  return {
    filename,
    revision: value.revision as number,
    source: { byteLength: value.source.byteLength as number, sha256: sourceSha256 },
    status: "readonly-future",
    version: filenameVersion,
  };
}

async function assertNoFutureAnnotation(
  directory: DatasetDirectoryHandle,
  sourceSha256: string,
): Promise<void> {
  for await (const [filename, handle] of directory.entries()) {
    const match = filename.match(ANNOTATION_FILENAME);
    if (
      handle.kind === "file" &&
      match?.[1] === sourceSha256 &&
      Number(match[2]) > ANNOTATION_CONTRACT_VERSION
    ) {
      throw new ReadonlyFutureVersionError(
        `A newer annotation sidecar already exists for ${sourceSha256}; it is read-only.`,
      );
    }
  }
}

async function parseStoredAnnotation(file: DatasetFileHandle): Promise<StoredAnnotation> {
  const bytes = await readBytes(file);
  const source = new TextDecoder().decode(bytes);
  const value: unknown = JSON.parse(source);
  assertAnnotationDocumentV1(value);
  if (serializeAnnotationDocumentV1(value) !== source) {
    throw new TypeError("Annotation document is not canonically ordered.");
  }
  return {
    document: value,
    version: { revision: value.revision, sha256: await sha256Hex(bytes) },
  };
}

async function optionalFile(
  directory: DatasetDirectoryHandle,
  name: string,
): Promise<DatasetFileHandle | null> {
  try {
    return await directory.getFileHandle(name);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function writeAndReadBack(handle: DatasetFileHandle, bytes: Uint8Array): Promise<Uint8Array> {
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
  const readBack = await readBytes(handle);
  if (!equalBytes(readBack, bytes)) {
    throw new TypeError("File read-back differs from the bytes that were written.");
  }
  return readBack;
}

async function readBytes(handle: DatasetFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

async function readPinnedFoundation(
  directory: DatasetDirectory,
  cache: Map<string, JudgmentFoundationV1>,
  reference: FoundationRefV1,
): Promise<JudgmentFoundationV1> {
  const existing = cache.get(reference.sha256);
  if (existing) {
    if (
      existing.foundationId !== reference.foundationId ||
      existing.revision !== reference.revision
    ) {
      throw new TypeError("Foundation digest is pinned with conflicting identity fields.");
    }
    return existing;
  }
  const foundation = await directory.readFoundation(reference);
  cache.set(reference.sha256, foundation);
  return foundation;
}

function hasMeaningfulEditorState(draft: AnnotationDraft): boolean {
  return (
    draft.range !== null ||
    draft.noteRefs.length > 0 ||
    draft.labels.length > 0 ||
    draft.editorText.trim().length > 0 ||
    draft.editingAnnotationId !== undefined ||
    draft.undoState.length > 0
  );
}

function sameVersion(left: DraftBaseVersion | null, right: DraftBaseVersion | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.revision === right.revision &&
      left.sha256 === right.sha256)
  );
}

function assertStableDocumentIdentity(
  current: AnnotationDocumentV1,
  next: AnnotationDocumentV1,
): void {
  if (
    current.documentId !== next.documentId ||
    current.createdAt !== next.createdAt ||
    serializeCanonicalJson(current.source) !== serializeCanonicalJson(next.source) ||
    serializeCanonicalJson(current.seedContext) !== serializeCanonicalJson(next.seedContext)
  ) {
    throw new TypeError(
      "A saved annotation document's identity and seed provenance are immutable.",
    );
  }

  assertStableRecordCreation(current.annotations, next.annotations, "gold annotation");
  assertStableRecordCreation(current.predictions, next.predictions, "silver prediction");
  assertStableRecordCreation(current.reviewNotes, next.reviewNotes, "review note");
  assertStablePredictionHistory(current, next);

  const nextReviewNoteIds = new Set(next.reviewNotes.map((note) => note.id));
  if (current.reviewNotes.some((note) => !nextReviewNoteIds.has(note.id))) {
    throw new TypeError("Saved review notes are durable and may be resolved but not deleted.");
  }
}

function assertStableRecordCreation(
  current: readonly { readonly id: string; readonly createdAt: string }[],
  next: readonly { readonly id: string; readonly createdAt: string }[],
  label: string,
): void {
  const createdAtById = new Map(current.map((entry) => [entry.id, entry.createdAt]));
  for (const entry of next) {
    const createdAt = createdAtById.get(entry.id);
    if (createdAt !== undefined && createdAt !== entry.createdAt) {
      throw new TypeError(`A saved ${label}'s ID and creation timestamp are immutable.`);
    }
  }
}

function assertStablePredictionHistory(
  current: AnnotationDocumentV1,
  next: AnnotationDocumentV1,
): void {
  const nextById = new Map(next.predictions.map((prediction) => [prediction.id, prediction]));
  for (const prediction of current.predictions) {
    const updated = nextById.get(prediction.id);
    if (
      !updated ||
      serializeCanonicalJson(immutablePredictionFields(prediction)) !==
        serializeCanonicalJson(immutablePredictionFields(updated))
    ) {
      throw new TypeError(
        "Saved silver predictions are immutable except for their review result fields.",
      );
    }
  }
}

function immutablePredictionFields(
  prediction: AnnotationDocumentV1["predictions"][number],
): unknown {
  return {
    ...(prediction.confidence === undefined ? {} : { confidence: prediction.confidence }),
    createdAt: prediction.createdAt,
    foundation: prediction.foundation,
    id: prediction.id,
    labels: prediction.labels,
    modelVersion: prediction.modelVersion,
    noteRefs: prediction.noteRefs,
    producerId: prediction.producerId,
    range: prediction.range,
    skillVersion: prediction.skillVersion,
  };
}

function assertDraftIdentity(
  draft: AnnotationDraft,
  datasetId: string,
  sourceSha256: string,
): void {
  if (draft.datasetId !== datasetId || draft.sourceSha256 !== sourceSha256) {
    throw new TypeError("Draft journal identity does not match the annotation document.");
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f\d]{64}$/.test(value)) throw new TypeError(`${label} is invalid.`);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "NotFoundError"
    : error instanceof Error && error.name === "NotFoundError";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
