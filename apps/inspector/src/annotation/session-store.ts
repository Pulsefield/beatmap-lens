import type { StableNoteRefV1, TimeRangeV1 } from "./contracts";

export interface DraftLabel {
  salience: 1 | 2;
  tagId: string;
}

export interface DraftBaseVersion {
  revision: number;
  sha256: string;
}

export interface AnnotationDraft {
  annotationEditorDirty?: boolean;
  base: DraftBaseVersion | null;
  datasetId: string;
  editorText: string;
  editingAnnotationId?: string;
  labels: readonly DraftLabel[];
  noteRefs: readonly StableNoteRefV1[];
  playheadMs: number;
  reviewNoteIncludeSelection?: boolean;
  reviewNoteText?: string;
  range: TimeRangeV1 | null;
  rangeEditor?: {
    readonly start: string;
    readonly end: string;
  };
  sourceSha256: string;
  undoState: readonly unknown[];
  visualSpeed: number;
}

export interface SessionPreferences {
  annotatorId: string;
  musicEnabled: boolean;
  visualSpeed: number;
}

export type DirectoryHandleKind = "corpus" | "dataset";

export interface SessionStore {
  deleteDraft(datasetId: string, sourceSha256: string): Promise<void>;
  getDirectoryHandle<T = unknown>(kind: DirectoryHandleKind): Promise<T | undefined>;
  getDraft(datasetId: string, sourceSha256: string): Promise<AnnotationDraft | undefined>;
  getPreferences(): Promise<SessionPreferences | undefined>;
  putDraft(draft: AnnotationDraft): Promise<void>;
  setDirectoryHandle(kind: DirectoryHandleKind, handle: unknown): Promise<void>;
  setPreferences(preferences: SessionPreferences): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  readonly #drafts = new Map<string, AnnotationDraft>();
  readonly #handles = new Map<DirectoryHandleKind, unknown>();
  #preferences?: SessionPreferences;

  async deleteDraft(datasetId: string, sourceSha256: string): Promise<void> {
    this.#drafts.delete(draftKey(datasetId, sourceSha256));
  }

  async getDirectoryHandle<T = unknown>(kind: DirectoryHandleKind): Promise<T | undefined> {
    return this.#handles.get(kind) as T | undefined;
  }

  async getDraft(datasetId: string, sourceSha256: string): Promise<AnnotationDraft | undefined> {
    return clone(this.#drafts.get(draftKey(datasetId, sourceSha256)));
  }

  async getPreferences(): Promise<SessionPreferences | undefined> {
    return clone(this.#preferences);
  }

  async putDraft(draft: AnnotationDraft): Promise<void> {
    this.#drafts.set(draftKey(draft.datasetId, draft.sourceSha256), clone(draft));
  }

  async setDirectoryHandle(kind: DirectoryHandleKind, handle: unknown): Promise<void> {
    this.#handles.set(kind, handle);
  }

  async setPreferences(preferences: SessionPreferences): Promise<void> {
    this.#preferences = clone(preferences);
  }
}

export class IndexedDbSessionStore implements SessionStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(name = "beatmap-lens-inspector", indexedDb: IDBFactory = indexedDB) {
    this.#database = openDatabase(indexedDb, name);
  }

  async deleteDraft(datasetId: string, sourceSha256: string): Promise<void> {
    await this.#request("drafts", "readwrite", (store) =>
      store.delete(draftKey(datasetId, sourceSha256)),
    );
  }

  async getDirectoryHandle<T = unknown>(kind: DirectoryHandleKind): Promise<T | undefined> {
    return (await this.#request("handles", "readonly", (store) => store.get(kind))) as
      | T
      | undefined;
  }

  async getDraft(datasetId: string, sourceSha256: string): Promise<AnnotationDraft | undefined> {
    return (await this.#request("drafts", "readonly", (store) =>
      store.get(draftKey(datasetId, sourceSha256)),
    )) as AnnotationDraft | undefined;
  }

  async getPreferences(): Promise<SessionPreferences | undefined> {
    return (await this.#request("preferences", "readonly", (store) => store.get("current"))) as
      | SessionPreferences
      | undefined;
  }

  async putDraft(draft: AnnotationDraft): Promise<void> {
    await this.#request("drafts", "readwrite", (store) =>
      store.put(draft, draftKey(draft.datasetId, draft.sourceSha256)),
    );
  }

  async setDirectoryHandle(kind: DirectoryHandleKind, handle: unknown): Promise<void> {
    await this.#request("handles", "readwrite", (store) => store.put(handle, kind));
  }

  async setPreferences(preferences: SessionPreferences): Promise<void> {
    await this.#request("preferences", "readwrite", (store) => store.put(preferences, "current"));
  }

  async #request(
    storeName: SessionStoreName,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      let result: unknown;
      request.addEventListener("success", () => {
        result = request.result;
      });
      request.addEventListener("error", () => reject(request.error));
      transaction.addEventListener("complete", () => resolve(result));
      transaction.addEventListener("abort", () => reject(transaction.error));
      transaction.addEventListener("error", () => reject(transaction.error));
    });
  }
}

type SessionStoreName = "drafts" | "handles" | "preferences";

function openDatabase(indexedDb: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name, 1);
    request.addEventListener("upgradeneeded", () => {
      for (const storeName of ["drafts", "handles", "preferences"] satisfies SessionStoreName[]) {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function draftKey(datasetId: string, sourceSha256: string): string {
  return `${datasetId}:${sourceSha256}`;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
