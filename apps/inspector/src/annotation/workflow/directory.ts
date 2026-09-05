import { serializeCanonicalJson, sha256Hex } from "../canonical-json";
import type { DatasetDirectoryHandle, DatasetFileHandle } from "../dataset-directory";
import { inspectOsuSourceV1 } from "../source-identity";
import type { FoundationV2, ReviewBaseV2, ReviewDocumentV2, TaskPacketV2 } from "./contracts";
import {
  type AddObservationsInputV2,
  addHumanObservationsV2,
  approveFoundationV2,
  createReviewDocumentV2,
  createTaskPacketV2,
  type DecideClaimInputV2,
  decideClaimV2,
  hashWorkflowValueV2,
  importAuditV2,
  importHandoffV2,
  type OperationOptionsV2,
  registerTaskV2,
  replaceProposedFoundationV2,
  reviewDocumentVersionV2,
  sameBase,
  validateReviewDocumentV2,
} from "./domain";

export interface StoredReviewV2 {
  readonly document: ReviewDocumentV2;
  readonly version: ReviewBaseV2;
}

export class WorkflowConflictError extends Error {
  readonly actual: ReviewBaseV2 | null;

  constructor(actual: ReviewBaseV2 | null) {
    super("V2 review changed on disk. Reopen the latest review before saving your human decision.");
    this.name = "WorkflowConflictError";
    this.actual = actual;
  }
}

/** Explicit commands are the canonical writer; exchange clients receive no document-save API. */
export class WorkflowDirectoryV2 {
  readonly #root: DatasetDirectoryHandle;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(root: DatasetDirectoryHandle) {
    this.#root = root;
  }

  async read(sourceSha256: string, sourceBytes?: Uint8Array): Promise<StoredReviewV2 | null> {
    const filename = reviewFilename(sourceSha256);
    const directory = await optionalDirectory(this.#root, "workflow");
    if (!directory) return null;
    const file = await optionalFile(directory, filename);
    if (!file) return null;
    const { input, sha256 } = await readCanonicalContent(file);
    await validateReviewDocumentV2(input, sourceBytes);
    // The read owns this fresh graph; keep sharing between immutable source/Foundation blobs.
    const document = input as ReviewDocumentV2;
    if (document.source.sha256 !== sourceSha256)
      throw new Error("V2 filename and source identity disagree.");
    return { document, version: { revision: document.revision, sha256 } };
  }

  async initialize(
    sourceBytes: Uint8Array,
    foundation: FoundationV2,
    options: OperationOptionsV2 = {},
  ): Promise<StoredReviewV2> {
    return this.#exclusive(async () => {
      const { source } = await inspectOsuSourceV1(sourceBytes);
      const existing = await this.read(source.sha256, sourceBytes);
      if (existing) return existing;
      if (foundation.approval.status !== "proposed") {
        throw new Error(
          "An imported Foundation cannot grant human approval. Initialize its proposed semantics and approve them through the human review command.",
        );
      }
      const document = await createReviewDocumentV2(source, foundation, options);
      return this.#write(document, null, sourceBytes);
    });
  }

  /** Reuse approval already recorded in this workspace; this is source registration, not approval. */
  async registerSourceFromApprovedFoundation(
    sourceBytes: Uint8Array,
    reference: { readonly sourceSha256: string; readonly foundationSha256: string },
    options: { readonly taskId?: string; readonly now?: () => string } = {},
  ): Promise<{ readonly stored: StoredReviewV2; readonly task: TaskPacketV2 }> {
    return this.#exclusive(async () => {
      const trusted = await this.read(reference.sourceSha256);
      if (!trusted) throw new Error("The Foundation source is not registered in this workspace.");
      const foundation = trusted.document.foundation;
      if ((await hashWorkflowValueV2(foundation)) !== reference.foundationSha256) {
        throw new Error("The referenced canonical Foundation hash differs.");
      }
      if (foundation.approval.status !== "human-approved") {
        throw new Error("The referenced canonical Foundation needs human approval.");
      }
      const { source } = await inspectOsuSourceV1(sourceBytes);
      const existing = await this.read(source.sha256, sourceBytes);
      if (existing) {
        if (
          (await hashWorkflowValueV2(existing.document.foundation)) !== reference.foundationSha256
        ) {
          throw new Error(
            "The existing source has a different Foundation; its history cannot be switched.",
          );
        }
        const task = existing.document.tasks.at(-1);
        if (!task) throw new Error("The existing source needs an explicit first task export.");
        return { stored: existing, task };
      }
      const initial = await createReviewDocumentV2(source, foundation, options);
      const task = await createTaskPacketV2(initial, sourceBytes, options);
      const document = await registerTaskV2(initial, task, sourceBytes, options);
      const stored = await this.#write(document, null, sourceBytes);
      return { stored, task };
    });
  }

  async exportTask(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    options: { readonly taskId?: string; readonly now?: () => string } = {},
  ): Promise<{ readonly stored: StoredReviewV2; readonly task: TaskPacketV2 }> {
    return this.#exclusive(async () => {
      const current = await this.#current(sourceBytes, expectedBase);
      const task = await createTaskPacketV2(current.document, sourceBytes, options);
      const document = await registerTaskV2(current.document, task, sourceBytes, options);
      const stored = await this.#write(document, expectedBase, sourceBytes);
      return { stored, task };
    });
  }

  async registerTask(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    task: TaskPacketV2,
    options: OperationOptionsV2 = {},
  ): Promise<StoredReviewV2> {
    return this.#command(sourceBytes, expectedBase, (document) =>
      registerTaskV2(document, task, sourceBytes, options),
    );
  }

  async importHandoff(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    input: unknown,
    options: OperationOptionsV2 = {},
  ): Promise<{
    readonly stored: StoredReviewV2;
    readonly status: "imported" | "duplicate";
    readonly baseStatus: "current" | "stale";
  }> {
    return this.#exclusive(async () => {
      const current = await this.#current(sourceBytes, expectedBase);
      const result = await importHandoffV2(current.document, input, sourceBytes, options);
      const stored =
        result.status === "duplicate"
          ? current
          : await this.#write(result.document, expectedBase, sourceBytes);
      return { stored, status: result.status, baseStatus: result.baseStatus };
    });
  }

  async decide(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    input: DecideClaimInputV2,
  ): Promise<StoredReviewV2> {
    return this.#command(sourceBytes, expectedBase, (document) =>
      decideClaimV2(document, input, sourceBytes),
    );
  }

  async importAudit(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    input: unknown,
    options: OperationOptionsV2 = {},
  ): Promise<{
    readonly stored: StoredReviewV2;
    readonly status: "imported" | "duplicate";
    readonly baseStatus: "current" | "stale";
  }> {
    return this.#exclusive(async () => {
      const current = await this.#current(sourceBytes, expectedBase);
      const result = await importAuditV2(current.document, input, sourceBytes, options);
      const stored =
        result.status === "duplicate"
          ? current
          : await this.#write(result.document, expectedBase, sourceBytes);
      return { stored, status: result.status, baseStatus: result.baseStatus };
    });
  }

  async addObservations(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    input: AddObservationsInputV2,
  ): Promise<StoredReviewV2> {
    return this.#command(sourceBytes, expectedBase, (document) =>
      addHumanObservationsV2(document, input, sourceBytes),
    );
  }

  async replaceProposedFoundation(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    foundation: FoundationV2,
    options: OperationOptionsV2 = {},
  ): Promise<StoredReviewV2> {
    return this.#command(sourceBytes, expectedBase, (document) =>
      replaceProposedFoundationV2(document, foundation, sourceBytes, options),
    );
  }

  async approveFoundation(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    humanId: string,
    options: OperationOptionsV2 = {},
  ): Promise<StoredReviewV2> {
    return this.#command(sourceBytes, expectedBase, (document) =>
      approveFoundationV2(document, humanId, sourceBytes, options),
    );
  }

  async #command(
    sourceBytes: Uint8Array,
    expectedBase: ReviewBaseV2,
    operation: (document: ReviewDocumentV2) => Promise<ReviewDocumentV2>,
  ): Promise<StoredReviewV2> {
    return this.#exclusive(async () => {
      const current = await this.#current(sourceBytes, expectedBase);
      const document = await operation(current.document);
      return document === current.document
        ? current
        : this.#write(document, expectedBase, sourceBytes);
    });
  }

  async #current(sourceBytes: Uint8Array, expectedBase: ReviewBaseV2): Promise<StoredReviewV2> {
    const { source } = await inspectOsuSourceV1(sourceBytes);
    const current = await this.read(source.sha256, sourceBytes);
    if (!current || !sameBase(current.version, expectedBase))
      throw new WorkflowConflictError(current?.version ?? null);
    return current;
  }

  async #write(
    document: ReviewDocumentV2,
    expectedBase: ReviewBaseV2 | null,
    sourceBytes: Uint8Array,
  ): Promise<StoredReviewV2> {
    await validateReviewDocumentV2(document, sourceBytes);
    const current = await this.read(document.source.sha256, sourceBytes);
    if (
      expectedBase === null
        ? current !== null
        : !current || !sameBase(current.version, expectedBase)
    )
      throw new WorkflowConflictError(current?.version ?? null);
    const directory = await this.#root.getDirectoryHandle("workflow", { create: true });
    const file = await directory.getFileHandle(reviewFilename(document.source.sha256), {
      create: true,
    });
    if (file.writeCanonicalJson) {
      const version = await reviewDocumentVersionV2(document);
      await file.writeCanonicalJson(document, version.sha256);
      if ((await readCanonicalContent(file)).sha256 !== version.sha256)
        throw new Error("V2 review read-back differs from the bytes written.");
      return { document, version };
    }
    const content = serializeCanonicalJson(document);
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
    if ((await (await file.getFile()).text()) !== content)
      throw new Error("V2 review read-back differs from the bytes written.");
    return { document, version: await reviewDocumentVersionV2(document) };
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(operation);
    this.#pending = next.catch(() => undefined);
    return next;
  }
}

async function readCanonicalContent(
  file: DatasetFileHandle,
): Promise<{ input: unknown; sha256: string }> {
  if (file.readCanonicalJson) {
    const { value, canonicalSha256 } = await file.readCanonicalJson();
    if ((await hashWorkflowValueV2(value)) !== canonicalSha256)
      throw new Error("V2 review document is not canonical JSON or its stored hash differs.");
    return { input: value, sha256: canonicalSha256 };
  }
  const text = await (await file.getFile()).text();
  const input: unknown = JSON.parse(text);
  if (serializeCanonicalJson(input) !== text)
    throw new Error("V2 review document is not canonical JSON.");
  return { input, sha256: await sha256Hex(text) };
}

function reviewFilename(sourceSha256: string): string {
  if (!/^[a-f\d]{64}$/.test(sourceSha256)) throw new Error("Invalid source SHA-256.");
  return `${sourceSha256}.v2.json`;
}

async function optionalDirectory(
  root: DatasetDirectoryHandle,
  name: string,
): Promise<DatasetDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name);
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") return null;
    throw error;
  }
}

async function optionalFile(
  directory: DatasetDirectoryHandle,
  name: string,
): Promise<DatasetFileHandle | null> {
  try {
    return await directory.getFileHandle(name);
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") return null;
    throw error;
  }
}
