import { describe, expect, it } from "vitest";
import type { AnnotationScanEntry } from "./dataset-directory";
import { deriveQueue } from "./queue";
import { fixtureDocument } from "./test-helpers";

describe("deriveQueue", () => {
  it("derives canonical review state by scanning sidecars with local state precedence", () => {
    const foundation = {
      foundationId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      sha256: "a".repeat(64),
    };
    const inProgress = fixtureDocument(foundation, { sourceSha256: "b".repeat(64) });
    const complete = fixtureDocument(foundation, {
      reviewState: "complete",
      sourceSha256: "c".repeat(64),
    });
    const scanned: AnnotationScanEntry[] = [inProgress, complete].map((document) => ({
      document,
      filename: `${document.source.sha256}.section-annotations.v1.json`,
      status: "ok",
      version: { revision: 1, sha256: "d".repeat(64) },
    }));
    scanned.push({
      filename: `${"2".repeat(64)}.section-annotations.v2.json`,
      revision: 3,
      source: { byteLength: 100, sha256: "2".repeat(64) },
      status: "readonly-future",
      version: 2,
    });
    const tasks = [
      task("new", "e"),
      task("draft", "f"),
      task("started", "b"),
      task("done", "c"),
      { ...task("missing", "0"), sourceAvailable: false },
      task("conflict", "1"),
      task("future", "2"),
    ];

    const queue = deriveQueue(scannedTasks(tasks), scanned, new Set(["f".repeat(64)]), [
      { sourceSha256: "1".repeat(64), type: "conflict" },
    ]);

    expect(queue.entries.map(({ id, status }) => [id, status])).toEqual([
      ["new", "unseen"],
      ["draft", "draft"],
      ["started", "in-progress"],
      ["done", "complete"],
      ["missing", "missing-source"],
      ["conflict", "save-conflict"],
      ["future", "readonly-future"],
    ]);
    expect(queue).toMatchObject({ complete: 1, total: 7 });
  });
});

function task(id: string, hashCharacter: string) {
  return { id, sourceAvailable: true, sourceSha256: hashCharacter.repeat(64) };
}

function scannedTasks<T>(tasks: readonly T[]): readonly T[] {
  return tasks;
}
