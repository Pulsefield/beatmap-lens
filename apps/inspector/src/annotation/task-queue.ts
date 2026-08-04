import {
  type CatalogSource,
  type CatalogTask,
  type ReadableDirectoryHandle,
  readCatalogTask,
} from "./catalog";
import type { SourceIdentityV1 } from "./contracts";
import type { DatasetDirectory } from "./dataset-directory";
import { deriveQueue, type QueueStatus } from "./queue";
import { hasMeaningfulDraft, type SessionStore } from "./session-store";
import { inspectOsuSourceV1 } from "./source-identity";

export type TaskQueueStatus = QueueStatus;

export interface TaskQueueItem {
  readonly id: string;
  readonly task: CatalogTask;
  readonly displayName: string;
  readonly source?: SourceIdentityV1;
  readonly status: TaskQueueStatus;
  readonly error?: string;
  readonly future?: {
    readonly revision: number;
    readonly version: number;
  };
}

export interface TaskQueueProgress {
  readonly complete: number;
  readonly total: number;
}

export async function loadTaskQueue(
  catalog: CatalogSource,
  corpus: ReadableDirectoryHandle,
  directory: DatasetDirectory,
  sessions: SessionStore,
  onProgress?: (loaded: number, total: number) => void,
): Promise<readonly TaskQueueItem[]> {
  const scans = await directory.scanAnnotations();
  const versions = new Map(
    scans.flatMap((entry) =>
      entry.status === "ok" ? [[entry.document.source.sha256, entry.version] as const] : [],
    ),
  );
  const scanErrors = new Map(
    scans.flatMap((entry) =>
      entry.status === "error" ? [[entry.filename.slice(0, 64), entry.error.message] as const] : [],
    ),
  );
  const futureBySource = new Map(
    scans.flatMap((entry) =>
      entry.status === "readonly-future"
        ? [[entry.source.sha256, { revision: entry.revision, version: entry.version }] as const]
        : [],
    ),
  );
  const drafts = new Map(
    (await sessions.listDrafts(directory.manifest.datasetId))
      .filter(hasMeaningfulDraft)
      .map((draft) => [draft.sourceSha256, draft] as const),
  );

  const loaded: Array<Omit<TaskQueueItem, "status"> & { sourceAvailable: boolean }> = [];
  const draftSourceHashes = new Set<string>();
  const issues: Array<{ sourceSha256: string; type: "conflict" | "error" }> = [];
  for (const [index, task] of catalog.tasks.entries()) {
    const id = task.pathSegments.join("/");
    const displayName = task.pathSegments.at(-1) ?? `Task ${index + 1}`;
    try {
      const file = await readCatalogTask(corpus, task);
      const inspected = await inspectOsuSourceV1(new Uint8Array(await file.arrayBuffer()));
      const draft = drafts.get(inspected.source.sha256);
      const error = scanErrors.get(inspected.source.sha256);
      const future = futureBySource.get(inspected.source.sha256);
      if (draft && !future) {
        if (sameVersion(draft.base, versions.get(inspected.source.sha256) ?? null)) {
          draftSourceHashes.add(inspected.source.sha256);
        } else {
          issues.push({ sourceSha256: inspected.source.sha256, type: "conflict" });
        }
      }
      loaded.push({
        id,
        task,
        displayName,
        source: inspected.source,
        sourceAvailable: true,
        ...(error ? { error } : {}),
        ...(future ? { future } : {}),
      });
    } catch (error) {
      loaded.push({
        id,
        task,
        displayName,
        sourceAvailable: false,
        error: errorMessage(error),
      });
    }
    onProgress?.(index + 1, catalog.tasks.length);
  }

  const derived = deriveQueue(
    loaded.map((task) => ({
      id: task.id,
      sourceAvailable: task.sourceAvailable,
      ...(task.source ? { sourceSha256: task.source.sha256 } : {}),
    })),
    scans,
    draftSourceHashes,
    issues,
  );
  const statuses = new Map(derived.entries.map((task) => [task.id, task.status]));
  return loaded.map(({ sourceAvailable: _, ...task }) => ({
    ...task,
    status: statuses.get(task.id) ?? "unseen",
  }));
}

export function queueProgress(queue: readonly TaskQueueItem[]): TaskQueueProgress {
  return {
    complete: queue.filter((task) => task.status === "complete").length,
    total: queue.length,
  };
}

export function updateQueueItemStatus(
  queue: readonly TaskQueueItem[],
  taskId: string,
  status: TaskQueueStatus,
  error?: string,
): readonly TaskQueueItem[] {
  return queue.map((task) => {
    if (task.id !== taskId) return task;
    const { error: _, ...rest } = task;
    return error ? { ...rest, status, error } : { ...rest, status };
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameVersion(
  left: { revision: number; sha256: string } | null,
  right: { revision: number; sha256: string } | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.revision === right.revision &&
      left.sha256 === right.sha256)
  );
}
