import type { AnnotationScanEntry, DatasetDirectory } from "./dataset-directory";

export type QueueStatus =
  | "unseen"
  | "draft"
  | "in-progress"
  | "complete"
  | "missing-source"
  | "save-conflict"
  | "save-error"
  | "readonly-future";

export interface QueueTask {
  readonly id: string;
  readonly sourceAvailable: boolean;
  readonly sourceSha256?: string;
}

export interface QueueIssue {
  readonly sourceSha256: string;
  readonly type: "conflict" | "error";
}

export interface QueueEntry extends QueueTask {
  readonly status: QueueStatus;
}

export interface QueueSummary {
  readonly complete: number;
  readonly entries: readonly QueueEntry[];
  readonly total: number;
}

export async function scanQueue(
  directory: DatasetDirectory,
  tasks: readonly QueueTask[],
  draftSourceHashes: ReadonlySet<string> = new Set(),
  issues: readonly QueueIssue[] = [],
): Promise<QueueSummary> {
  return deriveQueue(tasks, await directory.scanAnnotations(), draftSourceHashes, issues);
}

export function deriveQueue(
  tasks: readonly QueueTask[],
  annotations: readonly AnnotationScanEntry[],
  draftSourceHashes: ReadonlySet<string> = new Set(),
  issues: readonly QueueIssue[] = [],
): QueueSummary {
  const documents = new Map(
    annotations.flatMap((entry) =>
      entry.status === "ok"
        ? [[entry.document.source.sha256, entry.document.reviewState] as const]
        : [],
    ),
  );
  const scanErrors = new Set(
    annotations.flatMap((entry) => (entry.status === "error" ? [entry.filename.slice(0, 64)] : [])),
  );
  const futureSources = new Set(
    annotations.flatMap((entry) =>
      entry.status === "readonly-future" ? [entry.source.sha256] : [],
    ),
  );
  const issueBySource = new Map(issues.map((issue) => [issue.sourceSha256, issue.type]));

  const entries = tasks.map((task): QueueEntry => {
    const sourceSha256 = task.sourceSha256;
    const issue = sourceSha256 ? issueBySource.get(sourceSha256) : undefined;
    let status: QueueStatus;

    if (issue === "conflict") status = "save-conflict";
    else if (issue === "error" || (sourceSha256 && scanErrors.has(sourceSha256))) {
      status = "save-error";
    } else if (sourceSha256 && futureSources.has(sourceSha256)) status = "readonly-future";
    else if (!task.sourceAvailable) status = "missing-source";
    else if (sourceSha256 && draftSourceHashes.has(sourceSha256)) status = "draft";
    else status = sourceSha256 ? (documents.get(sourceSha256) ?? "unseen") : "unseen";

    return { ...task, status };
  });

  return {
    complete: entries.filter((entry) => entry.status === "complete").length,
    entries,
    total: entries.length,
  };
}
