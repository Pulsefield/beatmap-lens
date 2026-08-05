import { bench, describe } from "vitest";
import type { BeatmapSession } from "../apps/inspector/src/annotation/beatmap-session";
import { loadBeatmapSession } from "../apps/inspector/src/annotation/beatmap-session";
import type { CatalogSource, CatalogTask } from "../apps/inspector/src/annotation/catalog";
import type {
  AnnotationDocumentV1,
  FoundationRefV1,
} from "../apps/inspector/src/annotation/contracts";
import type { AnnotationScanEntry } from "../apps/inspector/src/annotation/dataset-directory";
import { createDatasetDirectory } from "../apps/inspector/src/annotation/dataset-directory";
import { foundationRefV1 } from "../apps/inspector/src/annotation/foundation";
import { deriveQueue, type QueueTask } from "../apps/inspector/src/annotation/queue";
import type { AnnotationDraft } from "../apps/inspector/src/annotation/session-store";
import { MemorySessionStore } from "../apps/inspector/src/annotation/session-store";
import { inspectOsuSourceV1 } from "../apps/inspector/src/annotation/source-identity";
import {
  createStableNoteRefIndexV1,
  createStableNoteRefsV1,
  resolveStableNoteRefsV1,
} from "../apps/inspector/src/annotation/stable-note-ref";
import {
  FakeDirectoryHandle,
  fixtureDocument,
  fixtureFoundation,
} from "../apps/inspector/src/annotation/test-helpers";

const denseSource = osuSource({
  beatmapId: 900_001,
  keyCount: 7,
  noteCount: 5_857,
  title: "Dense annotation benchmark",
});
const denseBytes = new TextEncoder().encode(denseSource);
const denseTask: CatalogTask = {
  categories: ["stream", "jack"],
  pathSegments: ["dense.osu"],
};
const denseCatalog: CatalogSource = {
  categories: ["jack", "stream"],
  sha256: "d".repeat(64),
  source: "https://example.test/annotation-benchmark.csv",
  tasks: [denseTask],
};
const benchOptions = {
  iterations: 5,
  time: 200,
  warmupIterations: 2,
  warmupTime: 50,
};
const now = "2026-08-04T00:00:00.000Z";

let _sink: unknown;

const denseInspected = await inspectOsuSourceV1(denseBytes);
const denseRefIndex = createStableNoteRefIndexV1(denseInspected.chart);
const persistedRefs = createStableNoteRefsV1(
  denseInspected.chart.notes.filter((_, index) => index % 23 === 0),
);
const selectedNoteIds = denseInspected.chart.notes
  .filter((_, index) => index % 29 === 0)
  .map((note) => note.id);
const benchmarkFoundation = fixtureFoundation();
const benchmarkFoundationRef = await foundationRefV1(benchmarkFoundation);
const queueFixture = await createQueueFixture(benchmarkFoundationRef);
const sessionFixture = await createDenseSessionFixture();

describe("inspector annotation lifecycle", () => {
  bench(
    "derive a representative 122-task queue",
    () => {
      _sink = deriveQueue(
        queueFixture.tasks,
        queueFixture.annotations,
        queueFixture.draftSourceHashes,
        queueFixture.issues,
      );
    },
    benchOptions,
  );

  bench(
    "inspect a dense valid .osu source",
    async () => {
      _sink = await inspectOsuSourceV1(denseBytes);
    },
    benchOptions,
  );

  bench(
    "open a dense beatmap session",
    async () => {
      _sink = await loadBeatmapSession(
        denseTask,
        denseCatalog,
        sessionFixture.corpus,
        sessionFixture.directory,
        sessionFixture.sessions,
        () => now,
        () => "00000000-0000-4000-8000-000000000099",
      );
    },
    benchOptions,
  );

  bench(
    "create stable refs for a dense chart",
    () => {
      _sink = createStableNoteRefsV1(denseInspected.chart);
    },
    benchOptions,
  );

  bench(
    "index stable refs for a dense chart",
    () => {
      _sink = createStableNoteRefIndexV1(denseInspected.chart);
    },
    benchOptions,
  );

  bench(
    "resolve persisted stable refs",
    () => {
      _sink = resolveStableNoteRefsV1(denseRefIndex, persistedRefs);
    },
    benchOptions,
  );

  bench(
    "build hot draft payload from selected notes",
    () => {
      _sink = buildHotDraft(sessionFixture.session, selectedNoteIds);
    },
    benchOptions,
  );
});

async function createDenseSessionFixture() {
  const corpus = new FakeDirectoryHandle("corpus");
  (await corpus.getFileHandle("dense.osu", { create: true })).setText(denseSource);
  const datasetRoot = new FakeDirectoryHandle("dataset");
  const directory = await createDatasetDirectory(datasetRoot, {
    catalogSources: [{ csvSha256: denseCatalog.sha256, url: denseCatalog.source }],
    datasetId: "00000000-0000-4000-8000-000000000011",
    foundation: benchmarkFoundation,
    name: "Annotation benchmark",
    now: () => now,
  });
  const sessions = new MemorySessionStore();
  const session = await loadBeatmapSession(
    denseTask,
    denseCatalog,
    corpus,
    directory,
    sessions,
    () => now,
    () => "00000000-0000-4000-8000-000000000098",
  );
  return { corpus, directory, session, sessions };
}

async function createQueueFixture(currentFoundation: FoundationRefV1) {
  const sources = await Promise.all(
    Array.from({ length: 122 }, async (_, index) => ({
      task: queueTask(index),
      source: (await inspectOsuSourceV1(new TextEncoder().encode(queueSource(index)))).source,
    })),
  );
  const tasks: QueueTask[] = sources.map(({ task, source }, index) => ({
    id: task.pathSegments.join("/"),
    sourceAvailable: index % 31 !== 0,
    sourceSha256: source.sha256,
  }));
  const annotations: AnnotationScanEntry[] = sources.flatMap(({ source }, index) => {
    if (index % 37 === 0) {
      return [
        {
          filename: `${source.sha256}.section-annotations.v2.json`,
          revision: 3,
          source,
          status: "readonly-future",
          version: 2,
        },
      ];
    }
    if (index % 5 !== 0) return [];

    const reviewState = index % 10 === 0 ? "complete" : "in-progress";
    const document: AnnotationDocumentV1 = {
      ...fixtureDocument(currentFoundation, { reviewState, sourceSha256: source.sha256 }),
      source,
    };
    return [
      {
        document,
        filename: `${source.sha256}.section-annotations.v1.json`,
        status: "ok",
        version: { revision: 1, sha256: `${(index % 16).toString(16)}`.repeat(64) },
      },
    ];
  });
  return {
    annotations,
    draftSourceHashes: new Set(
      sources.filter((_, index) => index % 7 === 0).map(({ source }) => source.sha256),
    ),
    issues: sources
      .filter((_, index) => index % 41 === 0)
      .map(({ source }) => ({ sourceSha256: source.sha256, type: "conflict" as const })),
    tasks,
  };
}

function buildHotDraft(session: BeatmapSession, noteIds: readonly string[]): AnnotationDraft {
  return {
    annotationEditorDirty: true,
    base: session.base,
    datasetId: "00000000-0000-4000-8000-000000000011",
    editorText: "dense draft",
    exemplarRoles: [{ kind: "strong", tagId: "stream" }],
    labels: [{ salience: 2, tagId: "stream" }],
    noteRefs: noteIds.flatMap((id) => {
      const ref = session.noteRefs.get(id);
      return ref ? [ref] : [];
    }),
    playheadMs: 42_000,
    range: { endMs: 54_000, startMs: 42_000 },
    rangeEditor: { end: "54.000", start: "42.000" },
    reviewNoteIncludeSelection: true,
    reviewNoteText: "",
    sourceSha256: session.source.sha256,
    undoState: [],
    visualSpeed: 240,
  };
}

function queueTask(index: number): CatalogTask {
  return {
    categories: index % 2 === 0 ? ["stream"] : ["jack"],
    pathSegments: [`queue-${String(index + 1).padStart(3, "0")}.osu`],
  };
}

function queueSource(index: number): string {
  return osuSource({
    beatmapId: 800_000 + index,
    keyCount: 4 + (index % 4),
    noteCount: 32 + (index % 17),
    title: `Queue benchmark ${index + 1}`,
  });
}

function osuSource(options: {
  readonly beatmapId: number;
  readonly keyCount: number;
  readonly noteCount: number;
  readonly title: string;
}): string {
  const hitObjects = Array.from({ length: options.noteCount }, (_, index) => {
    const column = index % options.keyCount;
    const x = Math.floor(((column + 0.5) * 512) / options.keyCount);
    const time = 1_000 + index * 43;
    if (index % 13 === 0) return `${x},192,${time},128,0,${time + 86}:0:0:0:`;
    return `${x},192,${time},1,0,0:0:0:0:`;
  });
  return `osu file format v14

[General]
Mode:3

[Metadata]
Title:${options.title}
Artist:Beatmap Lens
Creator:Codex
Version:${options.keyCount}K
BeatmapID:${options.beatmapId}
BeatmapSetID:700001

[Difficulty]
CircleSize:${options.keyCount}

[HitObjects]
${hitObjects.join("\n")}
`;
}
