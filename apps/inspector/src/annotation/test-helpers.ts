import type { AnnotationDocumentV1, FoundationRefV1, JudgmentFoundationV1 } from "./contracts";
import { ANNOTATION_CONTRACT, FOUNDATION_CONTRACT } from "./contracts";
import type {
  DatasetDirectoryHandle,
  DatasetFileHandle,
  DatasetHandle,
  FileLike,
  WritableFileLike,
} from "./dataset-directory";
import { FOUNDATION_POLICIES_V1 } from "./foundation";

const encoder = new TextEncoder();

export class FakeFileHandle implements DatasetFileHandle {
  corruptWrites = false;
  failWrites = false;
  readonly kind = "file";
  readonly name: string;
  #bytes = new Uint8Array();

  constructor(name: string) {
    this.name = name;
  }

  async createWritable(): Promise<WritableFileLike> {
    let next = new Uint8Array();
    return {
      close: async () => {
        this.#bytes = this.corruptWrites ? encoder.encode("corrupt") : next;
      },
      write: async (data) => {
        if (this.failWrites) throw new Error("simulated interrupted write");
        next = typeof data === "string" ? encoder.encode(data) : Uint8Array.from(data);
      },
    };
  }

  async getFile(): Promise<FileLike> {
    const snapshot = Uint8Array.from(this.#bytes);
    return {
      arrayBuffer: async () => Uint8Array.from(snapshot).buffer,
      text: async () => new TextDecoder().decode(snapshot),
    };
  }

  setText(source: string): void {
    this.#bytes = encoder.encode(source);
  }
}

export class FakeDirectoryHandle implements DatasetDirectoryHandle {
  readonly kind = "directory";
  readonly name: string;
  readonly children = new Map<string, DatasetHandle>();

  constructor(name = "root") {
    this.name = name;
  }

  async *entries(): AsyncIterableIterator<[string, DatasetHandle]> {
    for (const entry of [...this.children.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      yield entry;
    }
  }

  async getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing?.kind === "directory") return existing as FakeDirectoryHandle;
    if (existing || !options?.create) throw notFound(name);
    const directory = new FakeDirectoryHandle(name);
    this.children.set(name, directory);
    return directory;
  }

  async getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FakeFileHandle> {
    const existing = this.children.get(name);
    if (existing?.kind === "file") return existing as FakeFileHandle;
    if (existing || !options?.create) throw notFound(name);
    const file = new FakeFileHandle(name);
    this.children.set(name, file);
    return file;
  }
}

export function fixtureFoundation(): JudgmentFoundationV1 {
  return {
    contract: FOUNDATION_CONTRACT,
    createdAt: "2026-08-04T00:00:00.000Z",
    creatorId: "expert-a",
    foundationId: "00000000-0000-4000-8000-000000000001",
    language: "zh-CN",
    policies: FOUNDATION_POLICIES_V1,
    revision: 1,
    tags: [
      {
        aliases: [],
        definition: "A stream section.",
        displayName: "Stream",
        id: "stream",
        inclusionCues: ["Alternating single-note motion."],
        status: "active",
      },
      {
        aliases: [],
        definition: "A jack section.",
        displayName: "Jack",
        id: "jack",
        inclusionCues: ["Repeated notes in one column."],
        status: "active",
      },
    ],
    version: 1,
  };
}

export function fixtureDocument(
  foundation: FoundationRefV1,
  options: {
    readonly reviewState?: "complete" | "in-progress";
    readonly sourceSha256?: string;
  } = {},
): AnnotationDocumentV1 {
  const sourceSha256 = options.sourceSha256 ?? "b".repeat(64);
  return {
    annotations: [
      {
        annotatorId: "expert-a",
        createdAt: "2026-08-04T00:00:00.000Z",
        derivedFromPredictionIds: [],
        foundation,
        id: "00000000-0000-4000-8000-000000000003",
        labels: [
          { salience: 2, tagId: "stream" },
          { salience: 1, tagId: "jack" },
        ],
        exemplarRoles: [],
        noteRefs: [
          {
            column: 0,
            endMs: 1_000,
            kind: "normal",
            sourceLine: 42,
            startMs: 1_000,
          },
        ],
        range: { endMs: 2_000, startMs: 500 },
        updatedAt: "2026-08-04T00:00:00.000Z",
      },
    ],
    contract: ANNOTATION_CONTRACT,
    createdAt: "2026-08-04T00:00:00.000Z",
    documentId: "00000000-0000-4000-8000-000000000002",
    predictions: [],
    reviewNotes: [],
    reviewState: options.reviewState ?? "in-progress",
    revision: 1,
    seedContext: {
      catalogSha256: "d".repeat(64),
      suggestedTags: ["stream"],
    },
    source: {
      artist: "Artist",
      beatmapId: 123,
      beatmapSetId: 456,
      byteLength: 1024,
      creator: "Mapper",
      difficulty: "Expert",
      keyCount: 4,
      normalizerId: "beatmap-lens-mania-v1",
      noteCount: 1,
      osuFormatVersion: 14,
      sha256: sourceSha256,
      title: "Title",
    },
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  };
}

function notFound(name: string): Error {
  const error = new Error(`No such entry: ${name}`);
  error.name = "NotFoundError";
  return error;
}
