<script setup lang="ts">
import type { ManiaNote } from "beatmap-lens";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue";
import {
  AudioPlaybackController,
  type AudioPlaybackStatus,
  createBeatmapAudioFileContext,
} from "./annotation/audio-playback";
import {
  type BeatmapSession,
  createGoldAnnotation,
  loadBeatmapSession,
  noteIdsForRefs,
} from "./annotation/beatmap-session";
import {
  BufferedSceneController,
  type BufferedSceneFrame,
  type BufferedSceneInstrumentation,
  judgmentLineRatio,
  maximumVisualSpeed,
  minimumVisualSpeed,
  viewportYToSourceTime,
  visualSpeedPresets,
} from "./annotation/buffered-scene";
import {
  type CatalogSource,
  parseCatalogManifest,
} from "./annotation/catalog";
import type {
  AnnotationDocumentV1,
  AnnotationLabelV1,
  FoundationTagV1,
  GoldAnnotationV1,
  GoldExemplarRoleKindV1,
  GoldExemplarRoleV1,
  TimeRangeV1,
} from "./annotation/contracts";
import {
  createDatasetDirectory,
  type DatasetDirectory,
  FileSystemDatasetDirectory,
  openDatasetDirectoryAnyVersion,
  type ReadonlyFutureDatasetDirectory,
} from "./annotation/dataset-directory";
import {
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  ensureHandlePermission,
  pickCatalogManifest,
  pickCorpusDirectory,
  pickDatasetDirectory,
  supportsFileSystemAccess,
} from "./annotation/file-system-access";
import {
  bootstrapFoundationV1,
  canonicalCatalogTagSeedsV1,
  canonicalTagId,
  createActiveFoundationTagV1,
} from "./annotation/foundation";
import {
  createGestureTransaction,
  finalizeGestureTransaction,
  type GestureFinalization,
  type GestureTransaction,
  previewGestureTransaction,
  rollbackGestureTransaction,
  updateGestureTransaction,
} from "./annotation/gesture-transaction";
import {
  changeNoteSelectionRange,
  createNoteSelection,
  toggleSelectedNote,
} from "./annotation/note-selection";
import { ManiaNoteTimeIndex } from "./annotation/note-time-index";
import { createOverviewDensityPath } from "./annotation/overview-density";
import type {
  PlaybackClockState,
} from "./annotation/playback-clock";
import {
  addReviewNoteV1,
  completeAnnotationDocumentV1,
  resolveReviewNoteV1,
  sameTagOverlapWarningsV1,
} from "./annotation/quality";
import { RafMetrics } from "./annotation/raf-metrics";
import { rangeCandidates } from "./annotation/range";
import {
  buildGoldRelease,
  type GoldReleaseArtifact,
  sameGoldReleaseArtifact,
  writeGoldRelease,
} from "./annotation/release";
import {
  type AnnotationDraft,
  type DraftBaseVersion,
  IndexedDbSessionStore,
} from "./annotation/session-store";
import {
  loadTaskQueue,
  queueProgress,
  type TaskQueueItem,
  type TaskQueueStatus,
  updateQueueItemStatus,
} from "./annotation/task-queue";
import {
  createTimelineRange,
  moveTimelineRange,
  parseTimeInput,
  resizeTimelineRange,
  type TimelineRangeEdge,
  timelineEdgeHitWidth,
} from "./annotation/timeline-range";
import WorkspaceModeSwitch from "./WorkspaceModeSwitch.vue";
import {
  createWorkspaceLifecycleState,
  DraftJournalQueue,
  runWorkspaceOperation,
  workspaceOperationFlags,
} from "./workspace-lifecycle";
import type { WorkspaceMode } from "./workspace-mode";

type MobilePanel = "source" | "preview" | "details";
type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";
type TimelineDragKind = "create" | "move" | `resize-${TimelineRangeEdge}`;

interface EditorUndoState {
  readonly draftStart: string;
  readonly draftEnd: string;
  readonly selectedNoteIds: readonly string[];
  readonly manualExclusions: readonly string[];
  readonly labels: readonly AnnotationLabelV1[];
  readonly exemplarRoles: readonly GoldExemplarRoleV1[];
  readonly judgmentNote: string;
  readonly editingAnnotationId?: string;
}

interface TimelineDragState {
  readonly transaction: GestureTransaction<EditorUndoState, TimelineDragKind>;
  readonly range?: TimeRangeV1;
  freePlacement: boolean;
  moved: boolean;
}

interface ViewportDragState {
  readonly pointerId: number;
  readonly kind: "scrub" | "select";
  readonly anchorMs: number;
  readonly startClientY: number;
  readonly startTimeMs: number;
  readonly transaction?: GestureTransaction<EditorUndoState, "select">;
  freePlacement: boolean;
  lastClientY: number;
  moved: boolean;
}

interface FoundationExemplarView {
  readonly annotationId: string;
  readonly kind: GoldExemplarRoleKindV1;
  readonly range: TimeRangeV1;
  readonly sourceLabel: string;
  readonly tagId: string;
}

interface CatalogTagSuggestion {
  readonly displayName: string;
  readonly origin: "catalog";
  readonly tagId: string;
  readonly tag?: FoundationTagV1;
}

const rangeNotePageSize = 200;

const emit = defineEmits<{
  "change-mode": [mode: WorkspaceMode];
}>();

const sessions = new IndexedDbSessionStore();
const fileSystemSupported = supportsFileSystemAccess();
const annotatorId = ref("");
const datasetName = ref("Section gold v1");
const datasetHandle = shallowRef<BrowserDirectoryHandle>();
const corpusHandle = shallowRef<BrowserDirectoryHandle>();
const catalogHandle = shallowRef<BrowserFileHandle>();
const catalog = shallowRef<CatalogSource>();
const directory = shallowRef<DatasetDirectory>();
const futureDataset = shallowRef<ReadonlyFutureDatasetDirectory>();
const futureEntries = ref<readonly { filename: string; status: string }[]>([]);
const futureScanMessage = ref("");
const queue = ref<readonly TaskQueueItem[]>([]);
const activeTaskId = ref<string>();
const session = shallowRef<BeatmapSession>();
const readonlyTask = shallowRef<TaskQueueItem>();
const readonlyDraftPresent = ref(false);
const setupError = ref("");
const setupBusy = ref(false);
const setupProgress = ref("");
const taskError = ref("");
const activeMobilePanel = ref<MobilePanel>("preview");
const saveState = ref<SaveState>("idle");
const saveMessage = ref("Local draft only");
const draftStart = ref("0");
const draftEnd = ref("1000");
const rangeError = ref("");
const selectedNoteIds = ref<ReadonlySet<string>>(new Set());
const manualExclusions = ref<ReadonlySet<string>>(new Set());
const draftLabels = ref<readonly AnnotationLabelV1[]>([]);
const draftExemplarRoles = ref<readonly GoldExemplarRoleV1[]>([]);
const judgmentNote = ref("");
const tagQuery = ref("");
const editingAnnotationId = ref<string>();
const activationTag = ref<FoundationTagV1>();
const activationIsCustom = ref(false);
const activationTagId = ref("");
const activationDisplayName = ref("");
const activationDefinition = ref("");
const activationInclusionCues = ref("");
const activationExclusionCues = ref("");
const activationAliases = ref("");
const activationSalienceClarification = ref("");
const activationError = ref("");
const qualityMessage = ref("");
const foundationExemplarViews = ref<readonly FoundationExemplarView[]>([]);
const foundationDetailsDigest = ref<string>();
const foundationDetailsBusy = ref(false);
const foundationDetailsMessage = ref("");
const reviewNoteText = ref("");
const reviewNoteIncludeSelection = ref(true);
const exemplarTagId = ref("");
const exemplarKind = ref<GoldExemplarRoleKindV1>("strong");
const releasePreview = shallowRef<GoldReleaseArtifact>();
const releaseMessage = ref("");
const playheadMs = ref(0);
const visualSpeed = ref(240);
const visualSpeedDraft = ref("240");
const visualSpeedError = ref("");
const viewportSvg = ref<SVGSVGElement>();
const overviewSvg = ref<SVGSVGElement>();
const viewportSize = ref({ width: 720, height: 420 });
const overviewWidth = ref(720);
const viewportFrame = shallowRef<BufferedSceneFrame>();
const viewportInstrumentation = ref<BufferedSceneInstrumentation>();
const frameP95Ms = ref(0);
const gestureActive = ref(false);
const rangeNotePage = ref(0);
const playbackState = ref<PlaybackClockState>({
  currentTimeMs: 0,
  playing: false,
  looping: false,
});
const musicEnabled = ref(false);
const audioStatus = ref<AudioPlaybackStatus>({ kind: "idle" });
const focusedTagId = ref<string>();
const editorUndoStack = ref<readonly EditorUndoState[]>([]);
const draftBase = ref<DraftBaseVersion | null>(null);
const setupRestored = ref(false);
const editorDirty = ref(false);
const interactiveSessionGeneration = ref(0);
const workspaceLifecycle = reactive(createWorkspaceLifecycleState());
const draftJournal = new DraftJournalQueue(workspaceLifecycle);
let draftTimer: number | undefined;
let viewportController: BufferedSceneController | undefined;
let noteTimeIndex: ManiaNoteTimeIndex | undefined;
let playbackClock: AudioPlaybackController | undefined;
let unsubscribePlayback: (() => void) | undefined;
let unsubscribeAudio: (() => void) | undefined;
let viewportResizeObserver: ResizeObserver | undefined;
let timelineDrag: TimelineDragState | undefined;
let viewportDrag: ViewportDragState | undefined;
let gestureFrame: number | undefined;
let playbackAnimationFrame: number | undefined;
let pendingTextUndo: EditorUndoState | undefined;
let preferenceWrite = Promise.resolve();
const rafMetrics = new RafMetrics();

const activeTask = computed(() =>
  queue.value.find((task) => task.id === activeTaskId.value),
);
const progress = computed(() => queueProgress(queue.value));
const parsedRange = computed(() => readDraftRange(false));
const candidateNotes = computed(() => {
  if (!session.value || !parsedRange.value) return [];
  return rangeCandidates(session.value.chart, parsedRange.value);
});
const rangeNotePageCount = computed(() =>
  Math.max(1, Math.ceil(candidateNotes.value.length / rangeNotePageSize)),
);
const pagedRangeNotes = computed(() => {
  const start = rangeNotePage.value * rangeNotePageSize;
  return candidateNotes.value.slice(start, start + rangeNotePageSize);
});
const candidateNoteIds = computed(() => new Set(candidateNotes.value.map((note) => note.id)));
const selectedCount = computed(() => selectedNoteIds.value.size);
const activeTags = computed(() => filterTags("active"));
const customTagId = computed(() => canonicalTagId(tagQuery.value.trim()));
const canCreateCustomTag = computed(() => {
  const id = customTagId.value;
  return Boolean(id && !session.value?.foundation.tags.some((tag) => tag.id === id));
});
const suggestedTags = computed(() => {
  const current = session.value;
  if (!current) return [];
  return canonicalCatalogTagSeedsV1(current.task.categories).map(({ displayName, id }) => {
    const tag = current.foundation.tags.find((entry) => entry.id === id);
    return {
      displayName,
      origin: "catalog" as const,
      tagId: id,
      ...(tag ? { tag } : {}),
    };
  });
});
const annotationList = computed(
  () => session.value?.document.annotations ?? [],
);
const reviewNotes = computed(() => session.value?.document.reviewNotes ?? []);
const openReviewNoteCount = computed(
  () => reviewNotes.value.filter((note) => note.state === "open").length,
);
const pendingPredictionCount = computed(
  () =>
    session.value?.document.predictions.filter(
      (prediction) => prediction.reviewStatus === "pending",
    ).length ?? 0,
);
const hasUncommittedDraft = computed(
  () => editorDirty.value || Boolean(reviewNoteText.value.trim()),
);
const operationFlags = computed(() =>
  workspaceOperationFlags(workspaceLifecycle.activeOperation),
);
const operationLocked = computed(() => operationFlags.value.operationLocked);
const taskLoading = computed(() => operationFlags.value.taskLoading);
const activationBusy = computed(() => operationFlags.value.activationBusy);
const draftCleanupBlocked = computed(
  () => workspaceLifecycle.draftLifecycle === "cleanup-error",
);
const editorLocked = computed(
  () => operationLocked.value || draftCleanupBlocked.value || gestureActive.value,
);
const draftRecoveryVisible = computed(
  () =>
    hasUncommittedDraft.value ||
    workspaceLifecycle.draftLifecycle === "write-error" ||
    draftCleanupBlocked.value,
);
const overlapWarnings = computed(() => {
  const current = session.value;
  const currentDirectory = directory.value;
  if (!current || !currentDirectory) return [];

  const range = parsedRange.value;
  if (!range || draftLabels.value.length === 0 || selectedNoteIds.value.size === 0) {
    return sameTagOverlapWarningsV1(current.document);
  }
  try {
    const existing = current.document.annotations.find(
      (annotation) => annotation.id === editingAnnotationId.value,
    );
    const candidate = createGoldAnnotation(
      current,
      {
        ...(existing ? { existing } : { createId: () => "draft" }),
        annotatorId: annotatorId.value.trim() || "draft",
        judgmentNote: judgmentNote.value,
        labels: draftLabels.value,
        exemplarRoles: draftExemplarRoles.value,
        noteIds: [...selectedNoteIds.value],
        now: () => existing?.updatedAt ?? current.document.updatedAt,
        range,
      },
      currentDirectory.manifest.currentFoundation,
    );
    return sameTagOverlapWarningsV1(current.document, candidate);
  } catch {
    return sameTagOverlapWarningsV1(current.document);
  }
});
const exemplarTagOptions = computed(() => {
  const current = session.value;
  if (!current) return [];
  const annotationTags = new Set(draftLabels.value.map((label) => label.tagId));
  return current.foundation.tags.filter(
    (tag) =>
      tag.status === "active" &&
      (exemplarKind.value === "counterexample"
        ? !annotationTags.has(tag.id)
        : annotationTags.has(tag.id)),
  );
});
const releaseTagCounts = computed(() =>
  Object.entries(releasePreview.value?.manifest.tagCounts ?? {}),
);
const overviewDensity = computed(() =>
  session.value
    ? createOverviewDensityPath(session.value.chart, {
        width: 1_000,
        height: 62,
      })
    : undefined,
);
const timelineSelection = computed(() => {
  const range = parsedRange.value;
  if (!range || !session.value) return undefined;
  return rangeOverviewGeometry(range, session.value.chartEndMs);
});
const timelineViewport = computed(() => {
  if (!viewportFrame.value || !session.value) return undefined;
  return rangeOverviewGeometry(viewportFrame.value.viewportRange, session.value.chartEndMs, true);
});
const selectionBand = computed(() =>
  parsedRange.value && viewportFrame.value
    ? rangeSceneGeometry(parsedRange.value, viewportFrame.value)
    : undefined,
);
const annotationBands = computed(() =>
  viewportFrame.value
    ? (() => {
        const frame = viewportFrame.value;
        return annotationList.value.flatMap((annotation) => {
          const geometry = rangeSceneGeometry(annotation.range, frame);
          return geometry ? [{ annotation, ...geometry }] : [];
        });
      })()
    : [],
);
const overviewAnnotationBands = computed(() =>
  session.value
    ? annotationList.value.map((annotation) => ({
        annotation,
        ...rangeOverviewGeometry(annotation.range, session.value?.chartEndMs ?? 1),
      }))
    : [],
);
const overviewPlayheadX = computed(() =>
  session.value ? (playheadMs.value / session.value.chartEndMs) * 1_000 : 0,
);
const timelineHandleHitWidth = computed(
  () => timelineEdgeHitWidth(Math.max(1, overviewWidth.value), 1_000),
);
const currentChartLabel = computed(() => {
  if (!session.value) {
    const source = activeTask.value?.source;
    return source ? `${source.title} · ${source.difficulty}` : "No chart loaded";
  }
  return `${session.value.source.title} · ${session.value.source.difficulty}`;
});
const saveTone = computed(() => {
  if (
    saveState.value === "error" ||
    saveState.value === "conflict" ||
    workspaceLifecycle.draftLifecycle === "write-error" ||
    workspaceLifecycle.draftLifecycle === "cleanup-error"
  ) {
    return "error";
  }
  if (
    workspaceLifecycle.draftLifecycle === "pending" ||
    workspaceLifecycle.draftLifecycle === "stored"
  ) {
    return "warn";
  }
  if (saveState.value === "saved") return "ready";
  return "idle";
});
const audioStatusText = computed(() => {
  const status = audioStatus.value;
  if (status.kind === "ready") {
    return musicEnabled.value ? "Music on · media clock" : "Audio ready · Music off";
  }
  if (status.kind === "loading") return "Resolving chart audio";
  if (status.kind === "idle") return "Synthetic clock · Music off";
  return status.message;
});

onMounted(async () => {
  window.addEventListener("keydown", handleWorkspaceKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  viewportResizeObserver = new ResizeObserver(() => refreshInteractiveGeometry());
  if (!fileSystemSupported) return;
  try {
    const preferences = await sessions.getPreferences();
    if (preferences) {
      annotatorId.value = preferences.annotatorId;
      visualSpeed.value = preferences.visualSpeed;
      visualSpeedDraft.value = String(preferences.visualSpeed);
      musicEnabled.value = preferences.musicEnabled;
    }

    const storedDataset = await sessions.getDirectoryHandle<BrowserDirectoryHandle>("dataset");
    const storedCorpus = await sessions.getDirectoryHandle<BrowserDirectoryHandle>("corpus");
    if (storedDataset) datasetHandle.value = storedDataset;
    if (storedCorpus) corpusHandle.value = storedCorpus;
    setupRestored.value = Boolean(storedDataset || storedCorpus);
  } catch (error) {
    setupError.value = errorMessage(error);
  }
});

onBeforeUnmount(() => {
  rollbackActiveGesturesForDispose();
  void flushDraft().catch(() => {});
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  disposeInteractiveSession();
  viewportResizeObserver?.disconnect();
});

watch(
  interactiveSessionGeneration,
  async () => {
    await nextTick();
    await initializeInteractiveSession();
  },
  { flush: "post" },
);

watch(rangeNotePageCount, (pageCount) => {
  rangeNotePage.value = Math.min(rangeNotePage.value, pageCount - 1);
});

async function changeWorkspaceMode(mode: WorkspaceMode): Promise<void> {
  if (mode === "annotate" || draftCleanupBlocked.value) return;
  try {
    const result = await runWorkspaceOperation(
      workspaceLifecycle,
      "change-mode",
      async () => {
        pauseForEdit();
        await flushDraft();
      },
    );
    if (result.started) emit("change-mode", mode);
  } catch (error) {
    saveState.value = "error";
    saveMessage.value = errorMessage(error);
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== "hidden") {
    syncPlaybackInstrumentation(playbackState.value.playing);
    return;
  }
  resetPlaybackInstrumentation();
  if (draftCleanupBlocked.value) return;
  void flushDraft().catch((error) => {
    saveState.value = "error";
    saveMessage.value = errorMessage(error);
  });
}

async function chooseDataset(): Promise<void> {
  await runSetupAction(async () => {
    datasetHandle.value = await pickDatasetDirectory();
    await sessions.setDirectoryHandle("dataset", datasetHandle.value);
  });
}

async function chooseCorpus(): Promise<void> {
  await runSetupAction(async () => {
    corpusHandle.value = await pickCorpusDirectory();
    await sessions.setDirectoryHandle("corpus", corpusHandle.value);
  });
}

async function chooseCatalog(): Promise<void> {
  await runSetupAction(async () => {
    const handle = await pickCatalogManifest();
    const source = await (await handle.getFile()).text();
    catalog.value = parseCatalogManifest(source);
    catalogHandle.value = handle;
  });
}

async function startWorkspace(): Promise<void> {
  setupError.value = "";
  const id = annotatorId.value.trim();
  if (!id) return setSetupError("Enter a pseudonymous annotator ID.");
  if (!datasetHandle.value) return setSetupError("Select a dataset directory.");
  if (!catalog.value) return setSetupError("Select the local catalog manifest.");
  if (!corpusHandle.value) return setSetupError("Select the mapped corpus directory.");

  setupBusy.value = true;
  setupProgress.value = "Checking directory permissions";
  try {
    const [datasetPermission, corpusPermission] = await Promise.all([
      ensureHandlePermission(datasetHandle.value, "readwrite"),
      ensureHandlePermission(corpusHandle.value, "read"),
    ]);
    if (!datasetPermission || !corpusPermission) {
      throw new Error("Dataset read/write and corpus read permissions are required.");
    }

    await sessions.setPreferences({
      annotatorId: id,
      musicEnabled: musicEnabled.value,
      visualSpeed: visualSpeed.value,
    });

    setupProgress.value = "Opening dataset";
    const opened = await openOrCreateDataset(
      datasetHandle.value,
      catalog.value,
      id,
    );
    if (opened.mode === "readonly-future") {
      futureDataset.value = opened;
      futureScanMessage.value = "";
      try {
        futureEntries.value = await opened.scanAnnotations();
      } catch {
        futureEntries.value = [];
        futureScanMessage.value =
          "This dataset uses a newer file layout. Its manifest is available, but v1 cannot enumerate annotation files safely.";
      }
      setupProgress.value = "";
      return;
    }
    const nextDirectory = opened;
    if (
      !nextDirectory.manifest.catalogSources.some(
        (source) => source.csvSha256 === catalog.value?.sha256,
      )
    ) {
      throw new Error("The selected catalog does not match this dataset.");
    }

    setupProgress.value = `Loading 0 / ${catalog.value.tasks.length} tasks`;
    const nextQueue = await loadTaskQueue(
      catalog.value,
      corpusHandle.value,
      nextDirectory,
      sessions,
      (loaded, total) => {
        setupProgress.value = `Loading ${loaded} / ${total} tasks`;
      },
    );
    directory.value = nextDirectory;
    queue.value = nextQueue;
    const firstTask = nextQueue.find((task) => task.status !== "missing-source");
    if (firstTask) await loadTask(firstTask);
    setupProgress.value = "";
  } catch (error) {
    directory.value = undefined;
    queue.value = [];
    setupError.value = errorMessage(error);
  } finally {
    setupBusy.value = false;
  }
}

async function openTask(task: TaskQueueItem): Promise<void> {
  if (!catalog.value || !corpusHandle.value || !directory.value) return;
  if (task.status === "missing-source" || draftCleanupBlocked.value) return;
  await runWorkspaceOperation(workspaceLifecycle, "open-task", () => loadTask(task));
}

async function loadTask(task: TaskQueueItem): Promise<void> {
  if (!catalog.value || !corpusHandle.value || !directory.value) return;
  taskError.value = "";
  pauseForEdit();
  try {
    await flushDraft();
  } catch (error) {
    taskError.value = `Current draft not ready: ${errorMessage(error)}`;
    return;
  }

  try {
    if (task.status === "readonly-future") {
      session.value = undefined;
      interactiveSessionGeneration.value++;
      resetTaskQualityState();
      readonlyTask.value = task;
      readonlyDraftPresent.value = Boolean(
        task.source &&
          (await sessions.getDraft(directory.value.manifest.datasetId, task.source.sha256)),
      );
      workspaceLifecycle.draftLifecycle = readonlyDraftPresent.value ? "stored" : "clean";
      activeTaskId.value = task.id;
      saveState.value = "idle";
      saveMessage.value = `Annotation v${task.future?.version ?? "?"} · read-only`;
      return;
    }
    readonlyTask.value = undefined;
    readonlyDraftPresent.value = false;
    const next = await loadBeatmapSession(
      task.task,
      catalog.value,
      corpusHandle.value,
      directory.value,
      sessions,
    );
    session.value = next;
    activeTaskId.value = task.id;
    resetTaskQualityState();
    restoreEditor(next);
    interactiveSessionGeneration.value++;
    await nextTick();
  } catch (error) {
    taskError.value = errorMessage(error);
    queue.value = updateQueueItemStatus(
      queue.value,
      task.id,
      "save-error",
      taskError.value,
    );
  }
}

function restoreEditor(next: BeatmapSession): void {
  pendingTextUndo = undefined;
  const draft = next.restoredDraft;
  draftBase.value = draft?.base ?? next.base;
  playheadMs.value = draft?.playheadMs ?? 0;
  visualSpeed.value = draft?.visualSpeed ?? visualSpeed.value;
  visualSpeedDraft.value = String(visualSpeed.value);
  judgmentNote.value = draft?.editorText ?? "";
  reviewNoteIncludeSelection.value = draft?.reviewNoteIncludeSelection ?? true;
  reviewNoteText.value = draft?.reviewNoteText ?? "";
  draftLabels.value = draft?.labels ?? [];
  draftExemplarRoles.value = draft?.exemplarRoles ?? [];
  const selected = new Set(draft ? noteIdsForRefs(next, draft.noteRefs) : []);
  selectedNoteIds.value = selected;
  manualExclusions.value = new Set(
    draft?.range
      ? rangeCandidates(next.chart, draft.range).flatMap((note) =>
          selected.has(note.id) ? [] : [note.id],
        )
      : [],
  );
  editingAnnotationId.value = draft?.editingAnnotationId;
  rangeError.value = "";

  const range = draft?.range ?? initialRange(next);
  draftStart.value = draft?.rangeEditor?.start ?? formatMs(range.startMs);
  draftEnd.value = draft?.rangeEditor?.end ?? formatMs(range.endMs);
  if (!draft) selectAllCandidates(range);
  else readDraftRange(true);
  workspaceLifecycle.draftLifecycle = draft ? "stored" : "clean";
  saveState.value = next.base ? "saved" : "idle";
  saveMessage.value = draft
    ? "Draft restored"
    : next.base
      ? `Revision ${next.base.revision}`
      : "Unseen chart";
  editorDirty.value = draft?.annotationEditorDirty ?? Boolean(draft);
  editorUndoStack.value = readUndoState(draft?.undoState);
  syncExemplarTag();
}

async function initializeInteractiveSession(): Promise<void> {
  disposeInteractiveSession();
  const current = session.value;
  const svg = viewportSvg.value;
  if (!current || !svg) return;

  noteTimeIndex = new ManiaNoteTimeIndex(current.chart.notes);
  const controller = new AudioPlaybackController({
    preferenceStore: {
      getItem: () => (musicEnabled.value ? "on" : "off"),
      setItem: () => {},
    },
  });
  playbackClock = controller;
  const initialTime = Math.min(Math.max(0, playheadMs.value), current.chartEndMs);
  unsubscribePlayback = controller.subscribe((state) => {
    const active = session.value;
    if (!active || active.source.sha256 !== current.source.sha256) return;
    if (state.currentTimeMs > active.chartEndMs) {
      resetPlaybackInstrumentation();
      controller.seek(active.chartEndMs);
      controller.pause();
      return;
    }

    playbackState.value = state;
    playheadMs.value = state.currentTimeMs;
    updateViewportFrame(state.currentTimeMs);
    syncPlaybackInstrumentation(state.playing);
  });
  unsubscribeAudio = controller.subscribeAudio((state) => {
    if (playbackClock !== controller) return;
    musicEnabled.value = state.musicEnabled;
    audioStatus.value = state.status;
  });
  controller.seek(initialTime);
  viewportResizeObserver?.observe(svg);
  if (overviewSvg.value) viewportResizeObserver?.observe(overviewSvg.value);
  refreshInteractiveGeometry();

  const corpus = corpusHandle.value;
  if (!corpus) return;
  try {
    const context = await createBeatmapAudioFileContext(
      corpus as unknown as FileSystemDirectoryHandle,
      current.task,
      current.parsed,
    );
    if (playbackClock === controller && session.value?.source.sha256 === current.source.sha256) {
      resetPlaybackInstrumentation();
      try {
        await controller.loadBeatmapAudio(context);
      } finally {
        if (playbackClock === controller) restartPlaybackInstrumentation();
      }
    }
  } catch (error) {
    if (playbackClock === controller) {
      audioStatus.value = { kind: "missing", message: errorMessage(error) };
    }
  }
}

function disposeInteractiveSession(): void {
  rollbackActiveGesturesForDispose();
  resetPlaybackInstrumentation();
  viewportResizeObserver?.disconnect();
  unsubscribePlayback?.();
  unsubscribePlayback = undefined;
  unsubscribeAudio?.();
  unsubscribeAudio = undefined;
  playbackClock?.dispose();
  playbackClock = undefined;
  viewportController = undefined;
  noteTimeIndex = undefined;
  viewportFrame.value = undefined;
  viewportInstrumentation.value = undefined;
  playbackState.value = { currentTimeMs: playheadMs.value, playing: false, looping: false };
  audioStatus.value = { kind: "idle" };
  timelineDrag = undefined;
  viewportDrag = undefined;
  pendingTextUndo = undefined;
}

function rebuildViewportController(): void {
  const current = session.value;
  const svg = viewportSvg.value;
  if (!current || !svg) return;

  const rect = svg.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || viewportSize.value.width));
  const height = Math.max(1, Math.round(rect.height || viewportSize.value.height));
  if (
    viewportController &&
    viewportSize.value.width === width &&
    viewportSize.value.height === height
  ) {
    return;
  }

  viewportSize.value = { width, height };
  viewportController = new BufferedSceneController(current.chart, {
    width,
    viewportHeight: height,
    pixelsPerSecond: visualSpeed.value,
  });
  updateViewportFrame(playheadMs.value);
  restartPlaybackInstrumentation();
}

function refreshInteractiveGeometry(): void {
  const measuredOverviewWidth = overviewSvg.value?.getBoundingClientRect().width;
  if (measuredOverviewWidth && measuredOverviewWidth > 0) {
    overviewWidth.value = measuredOverviewWidth;
  }
  rebuildViewportController();
}

function updateViewportFrame(timeMs: number): void {
  if (!viewportController) return;
  viewportFrame.value = viewportController.frame(timeMs);
  viewportInstrumentation.value = viewportController.instrumentation();
}

function syncPlaybackInstrumentation(playing: boolean): void {
  if (!playing || document.visibilityState === "hidden") {
    resetPlaybackInstrumentation();
    return;
  }
  if (playbackAnimationFrame !== undefined) return;
  playbackAnimationFrame = requestAnimationFrame(samplePlaybackAnimationFrame);
}

function samplePlaybackAnimationFrame(timestamp: number): void {
  playbackAnimationFrame = undefined;
  if (!playbackState.value.playing || document.visibilityState === "hidden") {
    resetPlaybackInstrumentation();
    return;
  }
  const report = rafMetrics.recordFrame(timestamp);
  if (report !== undefined) frameP95Ms.value = report;
  playbackAnimationFrame = requestAnimationFrame(samplePlaybackAnimationFrame);
}

function resetPlaybackInstrumentation(): void {
  if (playbackAnimationFrame !== undefined) cancelAnimationFrame(playbackAnimationFrame);
  playbackAnimationFrame = undefined;
  rafMetrics.reset();
  frameP95Ms.value = 0;
}

function restartPlaybackInstrumentation(): void {
  resetPlaybackInstrumentation();
  syncPlaybackInstrumentation(playbackState.value.playing);
}

async function togglePlayback(): Promise<void> {
  const controller = playbackClock;
  if (!controller || !session.value || operationLocked.value) return;
  if (controller.playing) {
    resetPlaybackInstrumentation();
    controller.pause();
    return;
  }
  if (controller.currentTimeMs >= session.value.chartEndMs) seekPlayhead(0);
  await runPlaybackDiscontinuity(controller, () => controller.play());
}

async function toggleMusic(): Promise<void> {
  const controller = playbackClock;
  if (!controller || operationLocked.value) return;
  await runPlaybackDiscontinuity(controller, () =>
    controller.setMusicEnabled(!musicEnabled.value),
  );
  await persistSessionPreferences();
}

async function playSelectionOnce(): Promise<void> {
  const range = parsedRange.value;
  const controller = playbackClock;
  if (!controller || !range || operationLocked.value) return;
  await runPlaybackDiscontinuity(controller, () => controller.playSelection(range));
}

async function toggleSelectionLoop(): Promise<void> {
  const range = parsedRange.value;
  const controller = playbackClock;
  if (!controller || !range || operationLocked.value) return;
  if (playbackState.value.looping) {
    resetPlaybackInstrumentation();
    controller.pause();
    return;
  }
  await runPlaybackDiscontinuity(controller, () => controller.loopSelection(range));
}

async function runPlaybackDiscontinuity(
  controller: AudioPlaybackController,
  operation: () => Promise<void>,
): Promise<void> {
  resetPlaybackInstrumentation();
  try {
    await operation();
  } finally {
    if (playbackClock === controller) restartPlaybackInstrumentation();
  }
}

function pauseForEdit(): void {
  if (!playbackClock?.playing) return;
  resetPlaybackInstrumentation();
  playbackClock.pause();
}

function seekPlayhead(timeMs: number): void {
  const endMs = session.value?.chartEndMs ?? 0;
  const time = Math.min(Math.max(0, timeMs), endMs);
  resetPlaybackInstrumentation();
  if (playbackClock) playbackClock.seek(time);
  else {
    playheadMs.value = time;
    updateViewportFrame(time);
  }
}

async function selectVisualSpeed(speed: number): Promise<void> {
  visualSpeedDraft.value = String(speed);
  await applyVisualSpeed();
}

async function applyVisualSpeed(): Promise<void> {
  const speed = Number(visualSpeedDraft.value);
  if (
    !Number.isFinite(speed) ||
    speed < minimumVisualSpeed ||
    speed > maximumVisualSpeed
  ) {
    visualSpeedError.value = `Use ${minimumVisualSpeed} to ${maximumVisualSpeed} px/s.`;
    return;
  }

  await finalizeActiveGestures();
  visualSpeedError.value = "";
  visualSpeed.value = speed;
  if (viewportController) {
    viewportFrame.value = viewportController.setVisualSpeed(speed, playheadMs.value);
    viewportInstrumentation.value = viewportController.instrumentation();
  }
  restartPlaybackInstrumentation();
  await persistSessionPreferences();
  if (editorDirty.value) await persistDraftNow(true);
}

function persistSessionPreferences(): Promise<void> {
  const preferences = {
    annotatorId: annotatorId.value.trim(),
    musicEnabled: musicEnabled.value,
    visualSpeed: visualSpeed.value,
  };
  preferenceWrite = preferenceWrite
    .catch(() => {})
    .then(() => sessions.setPreferences(preferences));
  return preferenceWrite;
}

function applyTimelineRange(
  range: TimeRangeV1,
  captureUndo = true,
  updateDraft = true,
): void {
  if (editorLocked.value) return;
  pauseForEdit();
  if (captureUndo) recordEditorUndo();
  applyTimelineRangeState(range);
  if (updateDraft) markDraft();
}

function applyTimelineRangeState(range: TimeRangeV1): void {
  const current = session.value;
  if (!current) return;
  const previous = parsedRange.value;
  const selection = previous
    ? changeNoteSelectionRange(
        current.chart.notes,
        createNoteSelection(current.chart.notes, previous, manualExclusions.value),
        range,
      )
    : createNoteSelection(current.chart.notes, range, manualExclusions.value);
  draftStart.value = formatMs(selection.range.startMs);
  draftEnd.value = formatMs(selection.range.endMs);
  selectedNoteIds.value = new Set(selection.selectedNotes.map((note) => note.id));
  manualExclusions.value = selection.manualExclusions;
  rangeNotePage.value = 0;
  rangeError.value = "";
}

function beginTimelineDrag(event: PointerEvent, kind: TimelineDragKind): void {
  const svg = overviewSvg.value;
  const current = session.value;
  if (
    !svg ||
    !current ||
    !noteTimeIndex ||
    editorLocked.value ||
    timelineDrag ||
    viewportDrag
  ) {
    return;
  }
  const range = parsedRange.value ?? undefined;
  if (kind !== "create" && !range) return;

  event.preventDefault();
  pauseForEdit();
  svg.setPointerCapture(event.pointerId);
  timelineDrag = {
    transaction: createGestureTransaction({
      anchorMs: overviewTimeFromPointer(event),
      before: captureGestureSnapshot(),
      kind,
      pointerId: event.pointerId,
      startCoordinate: event.clientX,
    }),
    freePlacement: event.altKey,
    ...(range ? { range } : {}),
    moved: false,
  };
  gestureActive.value = true;
}

function moveTimelineDrag(event: PointerEvent): void {
  const drag = timelineDrag;
  if (!drag || drag.transaction.pointerId !== event.pointerId) return;
  updateGestureTransaction(drag.transaction, event.clientX);
  drag.freePlacement = event.altKey;
  if (Math.abs(event.clientX - drag.transaction.startCoordinate) >= 2) drag.moved = true;
  if (!drag.moved) return;
  queueGestureFrame();
}

function applyTimelineDragPreview(): void {
  const drag = timelineDrag;
  if (!drag?.moved) return;
  applyGesturePreview(drag.transaction, timelineRangeForDrag(drag));
}

async function endTimelineDrag(event: PointerEvent): Promise<void> {
  const drag = timelineDrag;
  if (!drag || drag.transaction.pointerId !== event.pointerId) return;
  updateGestureTransaction(drag.transaction, event.clientX);
  drag.freePlacement = event.altKey;
  if (Math.abs(event.clientX - drag.transaction.startCoordinate) >= 2) drag.moved = true;
  if (!drag.moved && event.type === "pointerup") seekPlayhead(overviewTimeFromPointer(event));
  await finalizeActiveGestures().catch(() => {});
}

function beginViewportGesture(event: PointerEvent): void {
  const svg = viewportSvg.value;
  if (!svg || !session.value || editorLocked.value || timelineDrag || viewportDrag) return;
  event.preventDefault();
  pauseForEdit();
  svg.setPointerCapture(event.pointerId);
  const startTimeMs = playheadMs.value;
  const startY = viewportYFromClientY(event.clientY);
  const anchorMs = viewportYToSourceTime({
    chartEndMs: session.value.chartEndMs,
    pixelsPerSecond: visualSpeed.value,
    playheadMs: startTimeMs,
    viewportHeight: viewportSize.value.height,
    viewportY: startY,
  });
  const kind = event.shiftKey ? "scrub" : "select";
  viewportDrag = {
    pointerId: event.pointerId,
    kind,
    anchorMs,
    startClientY: event.clientY,
    startTimeMs,
    ...(kind === "select"
      ? {
          transaction: createGestureTransaction({
            anchorMs,
            before: captureGestureSnapshot(),
            kind,
            pointerId: event.pointerId,
            startCoordinate: event.clientY,
          }),
        }
      : {}),
    lastClientY: event.clientY,
    freePlacement: event.altKey,
    moved: false,
  };
  gestureActive.value = true;
}

function moveViewportGesture(event: PointerEvent): void {
  const drag = viewportDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.lastClientY = event.clientY;
  if (drag.transaction) updateGestureTransaction(drag.transaction, event.clientY);
  drag.freePlacement = event.altKey;
  if (Math.abs(drag.startClientY - event.clientY) >= 2) drag.moved = true;
  if (!drag.moved) return;
  queueGestureFrame();
}

function applyViewportGesturePreview(): void {
  const drag = viewportDrag;
  const current = session.value;
  const index = noteTimeIndex;
  if (!drag?.moved || !current || !index) return;

  if (drag.kind === "scrub") {
    applyViewportScrub(drag);
    return;
  }
  const transaction = drag.transaction;
  if (!transaction) return;
  applyGesturePreview(transaction, viewportRangeForDrag(drag, current, index));
}

async function endViewportGesture(event: PointerEvent): Promise<void> {
  const drag = viewportDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.lastClientY = event.clientY;
  if (drag.transaction) updateGestureTransaction(drag.transaction, event.clientY);
  drag.freePlacement = event.altKey;
  if (Math.abs(drag.startClientY - event.clientY) >= 2) drag.moved = true;
  if (!drag.moved && event.type === "pointerup") {
    seekPlayhead(
      viewportYToSourceTime({
        chartEndMs: session.value?.chartEndMs ?? 0,
        pixelsPerSecond: visualSpeed.value,
        playheadMs: drag.startTimeMs,
        viewportHeight: viewportSize.value.height,
        viewportY: viewportYFromClientY(event.clientY),
      }),
    );
  }
  await finalizeActiveGestures().catch(() => {});
}

function queueGestureFrame(): void {
  if (gestureFrame !== undefined) return;
  gestureFrame = requestAnimationFrame(() => {
    gestureFrame = undefined;
    applyActiveGesturePreview();
  });
}

function cancelGestureFrame(): void {
  if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame);
  gestureFrame = undefined;
}

function applyActiveGesturePreview(): void {
  if (timelineDrag) applyTimelineDragPreview();
  else if (viewportDrag) applyViewportGesturePreview();
}

async function finalizeActiveGestures(): Promise<void> {
  cancelGestureFrame();
  const activeTimelineDrag = timelineDrag;
  const activeViewportDrag = viewportDrag;
  releaseActiveGesturePointers();
  timelineDrag = undefined;
  viewportDrag = undefined;
  gestureActive.value = false;
  if (activeTimelineDrag) {
    await applyGestureFinalization(
      finalizeGestureTransaction(
        activeTimelineDrag.transaction,
        activeTimelineDrag.moved ? timelineRangeForDrag(activeTimelineDrag) : undefined,
      ),
    );
  } else if (activeViewportDrag?.kind === "select" && activeViewportDrag.transaction) {
    await applyGestureFinalization(
      finalizeGestureTransaction(
        activeViewportDrag.transaction,
        activeViewportDrag.moved
          ? viewportRangeForDrag(activeViewportDrag, session.value, noteTimeIndex)
          : undefined,
      ),
    );
  } else if (activeViewportDrag?.moved) {
    applyViewportScrub(activeViewportDrag);
  }
}

function timelineRangeForDrag(drag: TimelineDragState): TimeRangeV1 | undefined {
  const current = session.value;
  const index = noteTimeIndex;
  if (!current || !index) return undefined;
  const transaction = drag.transaction;
  const timeMs = overviewTimeFromClientX(transaction.lastCoordinate);
  const options = {
    chartEndMs: current.chartEndMs,
    freePlacement: drag.freePlacement,
  };
  return transaction.kind === "create"
    ? createTimelineRange(transaction.anchorMs, timeMs, index, options)
    : transaction.kind === "move" && drag.range
      ? moveTimelineRange(
          drag.range,
          timeMs - transaction.anchorMs,
          index,
          options,
        )
      : drag.range
        ? resizeTimelineRange(
            drag.range,
            transaction.kind === "resize-start" ? "start" : "end",
            timeMs,
            index,
            options,
          )
        : undefined;
}

function viewportRangeForDrag(
  drag: ViewportDragState,
  current: BeatmapSession | undefined,
  index: ManiaNoteTimeIndex | undefined,
): TimeRangeV1 | undefined {
  if (!current || !index || drag.kind !== "select" || !drag.transaction) return undefined;
  const focusMs = viewportYToSourceTime({
    chartEndMs: current.chartEndMs,
    pixelsPerSecond: visualSpeed.value,
    playheadMs: drag.startTimeMs,
    viewportHeight: viewportSize.value.height,
    viewportY: viewportYFromClientY(drag.transaction.lastCoordinate),
  });
  return createTimelineRange(drag.transaction.anchorMs, focusMs, index, {
    chartEndMs: current.chartEndMs,
    freePlacement: drag.freePlacement,
  });
}

function applyViewportScrub(drag: ViewportDragState): void {
  const deltaY = drag.startClientY - drag.lastClientY;
  seekPlayhead(drag.startTimeMs + (deltaY / visualSpeed.value) * 1_000);
}

function captureGestureSnapshot() {
  return {
    editorState: captureEditorState(),
    undoStackLength: editorUndoStack.value.length,
    rangeError: rangeError.value,
    rangeNotePage: rangeNotePage.value,
    autosavePending: draftTimer !== undefined,
  };
}

function applyGesturePreview(
  transaction: GestureTransaction<EditorUndoState>,
  range: TimeRangeV1 | undefined,
): void {
  const preview = previewGestureTransaction(transaction, range);
  if (preview.outcome === "noop") return;
  if (preview.outcome === "restore") {
    restoreGestureSnapshot(transaction);
    return;
  }
  if (preview.firstValid && transaction.before.autosavePending && draftTimer !== undefined) {
    window.clearTimeout(draftTimer);
    draftTimer = undefined;
  }
  applyTimelineRangeState(preview.value);
}

function restoreGestureSnapshot(transaction: GestureTransaction<EditorUndoState>): void {
  applyEditorState(transaction.before.editorState);
  editorUndoStack.value = editorUndoStack.value.slice(0, transaction.before.undoStackLength);
  rangeError.value = transaction.before.rangeError;
  rangeNotePage.value = transaction.before.rangeNotePage;
}

async function applyGestureFinalization<TKind extends string>(
  finalization: GestureFinalization<EditorUndoState, TKind, TimeRangeV1>,
): Promise<void> {
  if (finalization.outcome === "rollback") {
    restoreGestureSnapshot(finalization.transaction);
    if (
      finalization.transaction.hasValidPreview &&
      finalization.transaction.before.autosavePending &&
      hasUncommittedDraft.value
    ) {
      await persistDraftNow(true);
    }
    return;
  }

  restoreGestureSnapshot(finalization.transaction);
  recordEditorUndo(finalization.transaction.before.editorState);
  applyTimelineRangeState(finalization.value);
  transitionDraft(false);
  await persistDraftNow(true);
}

function rollbackActiveGesturesForDispose(): void {
  cancelGestureFrame();
  const transactions = [
    timelineDrag?.transaction,
    viewportDrag?.transaction,
  ].flatMap((transaction) => (transaction ? [transaction] : []));
  releaseActiveGesturePointers();
  timelineDrag = undefined;
  viewportDrag = undefined;
  gestureActive.value = false;
  for (const transaction of transactions) {
    const rollback = rollbackGestureTransaction(transaction);
    restoreGestureSnapshot(rollback.transaction);
    restoreGestureAutosave(rollback.transaction);
  }
}

function restoreGestureAutosave(transaction: GestureTransaction<EditorUndoState>): void {
  if (
    !transaction.hasValidPreview ||
    !transaction.before.autosavePending ||
    !hasUncommittedDraft.value ||
    draftTimer !== undefined
  ) {
    return;
  }
  workspaceLifecycle.draftLifecycle = "pending";
  draftTimer = window.setTimeout(() => {
    draftTimer = undefined;
    void persistDraftNow(true).catch(() => {});
  }, 160);
}

function releaseActiveGesturePointers(): void {
  const timelinePointerId = timelineDrag?.transaction.pointerId;
  if (timelinePointerId !== undefined && overviewSvg.value?.hasPointerCapture(timelinePointerId)) {
    overviewSvg.value.releasePointerCapture(timelinePointerId);
  }
  const viewportPointerId = viewportDrag?.pointerId;
  if (viewportPointerId !== undefined && viewportSvg.value?.hasPointerCapture(viewportPointerId)) {
    viewportSvg.value.releasePointerCapture(viewportPointerId);
  }
}

async function handleWorkspaceKeydown(event: KeyboardEvent): Promise<void> {
  if (
    !session.value ||
    editorLocked.value ||
    event.defaultPrevented ||
    isTypingTarget(event.target)
  ) {
    return;
  }
  if (timelineDrag || viewportDrag) return;
  if (
    isNativeActivationTarget(event.target) &&
    (event.key === " " || event.key === "Enter")
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    undoEditor();
    return;
  }

  if (event.key === " ") {
    event.preventDefault();
    if (event.shiftKey) await playSelectionOnce();
    else await togglePlayback();
    return;
  }
  if (key === "i" || key === "o") {
    event.preventDefault();
    setRangeEdgeAtPlayhead(key === "i" ? "start" : "end");
    return;
  }
  if (key === "l") {
    event.preventDefault();
    await toggleSelectionLoop();
    return;
  }
  if (key === "1" || key === "2") {
    const tagId = focusedTagId.value ?? draftLabels.value.at(-1)?.tagId;
    if (!tagId) return;
    event.preventDefault();
    setSalience(tagId, key === "1" ? 1 : 2);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    await commitAnnotation();
    return;
  }
  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    seekRelativeAnnotation(event.key === "[" ? -1 : 1);
  }
}

function setRangeEdgeAtPlayhead(edge: TimelineRangeEdge): void {
  const range = parsedRange.value;
  if (!range || !session.value || !noteTimeIndex) return;
  const resized = resizeTimelineRange(range, edge, playheadMs.value, noteTimeIndex, {
    chartEndMs: session.value.chartEndMs,
    freePlacement: true,
  });
  if (!resized) {
    rangeError.value = edge === "start" ? "Start must be before end." : "End must be after start.";
    return;
  }
  applyTimelineRange(resized);
}

function seekRelativeAnnotation(direction: -1 | 1): void {
  const sorted = [...annotationList.value].sort(
    (left, right) => left.range.startMs - right.range.startMs,
  );
  if (sorted.length === 0) return;
  const target =
    direction === 1
      ? (sorted.find((annotation) => annotation.range.startMs > playheadMs.value) ?? sorted[0])
      : ([...sorted].reverse().find((annotation) => annotation.range.startMs < playheadMs.value) ??
        sorted.at(-1));
  if (target) seekAnnotation(target);
}

function recordEditorUndo(state = captureEditorState()): void {
  const previous = editorUndoStack.value.at(-1);
  if (previous && JSON.stringify(previous) === JSON.stringify(state)) return;
  editorUndoStack.value = [...editorUndoStack.value.slice(-29), state];
}

function captureEditorState(): EditorUndoState {
  return {
    draftStart: draftStart.value,
    draftEnd: draftEnd.value,
    selectedNoteIds: [...selectedNoteIds.value],
    manualExclusions: [...manualExclusions.value],
    labels: draftLabels.value.map((label) => ({ ...label })),
    exemplarRoles: draftExemplarRoles.value.map((role) => ({ ...role })),
    judgmentNote: judgmentNote.value,
    ...(editingAnnotationId.value ? { editingAnnotationId: editingAnnotationId.value } : {}),
  };
}

function applyEditorState(state: EditorUndoState): void {
  draftStart.value = state.draftStart;
  draftEnd.value = state.draftEnd;
  selectedNoteIds.value = new Set(state.selectedNoteIds);
  manualExclusions.value = new Set(state.manualExclusions);
  draftLabels.value = state.labels;
  draftExemplarRoles.value = state.exemplarRoles;
  judgmentNote.value = state.judgmentNote;
  editingAnnotationId.value = state.editingAnnotationId;
  syncExemplarTag();
}

function undoEditor(): void {
  const state = editorUndoStack.value.at(-1);
  if (!state) return;
  pauseForEdit();
  editorUndoStack.value = editorUndoStack.value.slice(0, -1);
  applyEditorState(state);
  rangeError.value = "";
  markDraft();
}

function beginTextEdit(): void {
  pauseForEdit();
  pendingTextUndo ??= captureEditorState();
}

function finishTextEdit(): void {
  if (!pendingTextUndo) return;
  if (JSON.stringify(pendingTextUndo) !== JSON.stringify(captureEditorState())) {
    recordEditorUndo(pendingTextUndo);
    markDraft();
  }
  pendingTextUndo = undefined;
}

function finishRangeEdit(): void {
  finishTextEdit();
  applyManualRange(false);
}

function readUndoState(value: readonly unknown[] | undefined): readonly EditorUndoState[] {
  return (value ?? []).flatMap((entry) => (isEditorUndoState(entry) ? [entry] : []));
}

function isEditorUndoState(value: unknown): value is EditorUndoState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<EditorUndoState>;
  return (
    typeof state.draftStart === "string" &&
    typeof state.draftEnd === "string" &&
    Array.isArray(state.selectedNoteIds) &&
    Array.isArray(state.manualExclusions) &&
    Array.isArray(state.labels) &&
    Array.isArray(state.exemplarRoles) &&
    typeof state.judgmentNote === "string"
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function isNativeActivationTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, summary, [role='button'], [role='link']"))
  );
}

function overviewTimeFromPointer(event: PointerEvent): number {
  return overviewTimeFromClientX(event.clientX);
}

function overviewTimeFromClientX(clientX: number): number {
  const rect = overviewSvg.value?.getBoundingClientRect();
  const endMs = session.value?.chartEndMs ?? 0;
  if (!rect || rect.width === 0) return 0;
  return Math.min(Math.max(0, ((clientX - rect.left) / rect.width) * endMs), endMs);
}

function viewportYFromClientY(clientY: number): number {
  const rect = viewportSvg.value?.getBoundingClientRect();
  if (!rect || rect.height === 0) return viewportSize.value.height * judgmentLineRatio;
  return ((clientY - rect.top) / rect.height) * viewportSize.value.height;
}

function applyManualRange(captureUndo = true): void {
  if (editorLocked.value) return;
  const range = readDraftRange(true);
  if (!range) return;
  pauseForEdit();
  if (captureUndo) recordEditorUndo();
  const selection = createNoteSelection(
    session.value?.chart.notes ?? [],
    range,
    manualExclusions.value,
  );
  manualExclusions.value = selection.manualExclusions;
  selectedNoteIds.value = new Set(selection.selectedNotes.map((note) => note.id));
  markDraft();
}

function toggleNote(note: ManiaNote): void {
  if (!session.value || editorLocked.value) return;
  const range = readDraftRange(true);
  if (!range) return;
  pauseForEdit();
  recordEditorUndo();
  const selection = toggleSelectedNote(
    session.value.chart.notes,
    createNoteSelection(session.value.chart.notes, range, manualExclusions.value),
    note,
  );
  draftStart.value = formatMs(selection.range.startMs);
  draftEnd.value = formatMs(selection.range.endMs);
  selectedNoteIds.value = new Set(selection.selectedNotes.map((candidate) => candidate.id));
  manualExclusions.value = selection.manualExclusions;
  markDraft();
}

function toggleSceneNote(noteId: string): void {
  const note = session.value?.chart.notes.find((candidate) => candidate.id === noteId);
  if (note) toggleNote(note);
}

function addTag(tag: FoundationTagV1): void {
  if (editorLocked.value) return;
  applyTagToDraft(tag);
}

function applyTagToDraft(tag: FoundationTagV1): void {
  if (tag.status !== "active") return;
  if (draftLabels.value.some((label) => label.tagId === tag.id)) return;
  pauseForEdit();
  recordEditorUndo();
  draftLabels.value = [...draftLabels.value, { tagId: tag.id, salience: 2 }];
  draftExemplarRoles.value = draftExemplarRoles.value.filter(
    (role) => role.tagId !== tag.id || role.kind !== "counterexample",
  );
  focusedTagId.value = tag.id;
  tagQuery.value = "";
  syncExemplarTag();
  transitionDraft();
}

function beginSuggestedTagCreation(suggestion: CatalogTagSuggestion): void {
  if (editorLocked.value) return;
  pauseForEdit();
  activationTag.value = {
    aliases: [],
    definition: "",
    displayName: suggestion.displayName,
    id: suggestion.tagId,
    inclusionCues: [],
    status: "active",
  };
  activationIsCustom.value = false;
  activationTagId.value = suggestion.tagId;
  activationDisplayName.value = suggestion.displayName;
  activationDefinition.value = "";
  activationInclusionCues.value = "";
  activationExclusionCues.value = "";
  activationAliases.value = "";
  activationSalienceClarification.value = "";
  activationError.value = "";
}

function useSuggestedTag(suggestion: CatalogTagSuggestion): void {
  if (suggestion.tag?.status === "active") addTag(suggestion.tag);
  else if (!suggestion.tag) beginSuggestedTagCreation(suggestion);
}

function beginCustomTagActivation(): void {
  if (editorLocked.value || !canCreateCustomTag.value) return;
  pauseForEdit();
  const displayName = tagQuery.value.trim();
  activationTag.value = {
    aliases: [],
    definition: "",
    displayName,
    id: customTagId.value,
    inclusionCues: [],
    status: "active",
  };
  activationIsCustom.value = true;
  activationTagId.value = customTagId.value;
  activationDisplayName.value = displayName;
  activationDefinition.value = "";
  activationInclusionCues.value = "";
  activationExclusionCues.value = "";
  activationAliases.value = "";
  activationSalienceClarification.value = "";
  activationError.value = "";
}

function cancelTagActivation(): void {
  activationTag.value = undefined;
  activationIsCustom.value = false;
  activationTagId.value = "";
  activationDisplayName.value = "";
  activationDefinition.value = "";
  activationInclusionCues.value = "";
  activationExclusionCues.value = "";
  activationAliases.value = "";
  activationSalienceClarification.value = "";
  activationError.value = "";
}

async function activateTag(): Promise<void> {
  if (
    !session.value ||
    !directory.value ||
    !activationTag.value
  ) {
    return;
  }
  await runWorkspaceOperation(workspaceLifecycle, "activate-tag", async () => {
    activationError.value = "";
    const activatingSession = session.value;
    const activatingTag = activationTag.value;
    const activatingDirectory = directory.value;
    if (!activatingSession || !activatingTag || !activatingDirectory) return;

    try {
      const tagId = canonicalTagId(activationTagId.value);
      const nextFoundation = await createActiveFoundationTagV1(
        activatingSession.foundation,
        {
          aliases: linesFromText(activationAliases.value),
          definition: activationDefinition.value,
          displayName: activationDisplayName.value,
          exclusionCues: linesFromText(activationExclusionCues.value),
          inclusionCues: linesFromText(activationInclusionCues.value),
          salienceClarification: activationSalienceClarification.value,
          tagId,
        },
        {
          creatorId: annotatorId.value.trim(),
          createdAt: new Date().toISOString(),
        },
      );
      await activatingDirectory.setCurrentFoundation(nextFoundation);
      session.value = { ...activatingSession, foundation: nextFoundation };
      foundationDetailsDigest.value = undefined;
      const activated = nextFoundation.tags.find((tag) => tag.id === tagId);
      if (activated) applyTagToDraft(activated);
      cancelTagActivation();
      invalidateReleasePreview();
      saveMessage.value = `Foundation r${nextFoundation.revision} verified · annotation draft pending`;
    } catch (error) {
      activationError.value = errorMessage(error);
    }
  });
}

function removeTag(tagId: string): void {
  if (editorLocked.value) return;
  pauseForEdit();
  recordEditorUndo();
  draftLabels.value = draftLabels.value.filter((label) => label.tagId !== tagId);
  draftExemplarRoles.value = draftExemplarRoles.value.filter(
    (role) => role.tagId !== tagId || role.kind === "counterexample",
  );
  if (focusedTagId.value === tagId) focusedTagId.value = draftLabels.value.at(-1)?.tagId;
  syncExemplarTag();
  markDraft();
}

function setSalience(tagId: string, salience: 1 | 2): void {
  if (editorLocked.value) return;
  if (!draftLabels.value.some((label) => label.tagId === tagId && label.salience !== salience)) {
    return;
  }
  pauseForEdit();
  recordEditorUndo();
  focusedTagId.value = tagId;
  draftLabels.value = draftLabels.value.map((label) =>
    label.tagId === tagId ? { ...label, salience } : label,
  );
  markDraft();
}

async function commitAnnotation(): Promise<void> {
  if (!session.value || !directory.value || draftCleanupBlocked.value) return;
  await runWorkspaceOperation(workspaceLifecycle, "canonical-save", async () => {
    await finalizeActiveGestures();
    const current = session.value;
    const currentDirectory = directory.value;
    const range = readDraftRange(true);
    if (!current || !currentDirectory || !range) return;
    if (selectedNoteIds.value.size === 0) {
      return setRangeError("Select at least one intersecting note.");
    }
    if (draftLabels.value.length === 0) {
      return setRangeError("Add at least one active tag.");
    }
    pauseForEdit();

    const existing = current.document.annotations.find(
      (annotation) => annotation.id === editingAnnotationId.value,
    );
    const gold = createGoldAnnotation(
      current,
      {
        ...(existing ? { existing } : {}),
        range,
        noteIds: [...selectedNoteIds.value],
        labels: draftLabels.value,
        exemplarRoles: draftExemplarRoles.value,
        judgmentNote: judgmentNote.value,
        annotatorId: annotatorId.value.trim(),
      },
      currentDirectory.manifest.currentFoundation,
    );
    const annotations = existing
      ? current.document.annotations.map((annotation) =>
          annotation.id === existing.id ? gold : annotation,
        )
      : [...current.document.annotations, gold];
    const preserveReviewComposer = Boolean(reviewNoteText.value.trim());
    const saved = await persistDocument({
      ...current.document,
      annotations,
      reviewState: "in-progress",
    });
    if (!saved) return;

    if (!preserveReviewComposer) {
      try {
        await cleanupCurrentDraftJournal();
      } catch {
        return;
      }
    }
    editorDirty.value = false;
    seekPlayhead(range.endMs);
    clearEditor(range.endMs);
    if (preserveReviewComposer && !(await reconcileCanonicalDraft())) return;
    publishCanonicalState();
  });
}

function editAnnotation(annotation: GoldAnnotationV1): void {
  if (!session.value || editorLocked.value) return;
  if (hasUncommittedDraft.value) {
    qualityMessage.value = "Commit or discard the current draft before editing another gold section.";
    return;
  }
  pauseForEdit();
  editingAnnotationId.value = annotation.id;
  draftStart.value = formatMs(annotation.range.startMs);
  draftEnd.value = formatMs(annotation.range.endMs);
  const selected = new Set(noteIdsForRefs(session.value, annotation.noteRefs));
  selectedNoteIds.value = selected;
  const exclusions = new Set(
    rangeCandidates(session.value.chart, annotation.range).flatMap((note) =>
      selected.has(note.id) ? [] : [note.id],
    ),
  );
  manualExclusions.value = createNoteSelection(
    session.value.chart.notes,
    annotation.range,
    exclusions,
  ).manualExclusions;
  draftLabels.value = annotation.labels;
  draftExemplarRoles.value = annotation.exemplarRoles;
  judgmentNote.value = annotation.judgmentNote ?? "";
  playheadMs.value = annotation.range.startMs;
  seekPlayhead(annotation.range.startMs);
  rangeError.value = "";
  editorUndoStack.value = [];
  editorDirty.value = false;
  syncExemplarTag();
  saveState.value = session.value.base ? "saved" : "idle";
  saveMessage.value = `Editing gold · revision ${session.value.base?.revision ?? 0} unchanged`;
}

function seekAnnotation(annotation: GoldAnnotationV1): void {
  seekPlayhead(annotation.range.startMs);
}

async function playAnnotation(annotation: GoldAnnotationV1): Promise<void> {
  const controller = playbackClock;
  if (!controller || operationLocked.value) return;
  await runPlaybackDiscontinuity(controller, () => controller.playSelection(annotation.range));
}

async function deleteAnnotation(annotation: GoldAnnotationV1): Promise<void> {
  if (!session.value || draftCleanupBlocked.value) return;
  await runWorkspaceOperation(workspaceLifecycle, "canonical-save", async () => {
    await finalizeActiveGestures();
    const current = session.value;
    if (!current) return;
    pauseForEdit();
    const deletingEditor = editingAnnotationId.value === annotation.id;
    const preserveOtherDraft = editorDirty.value && !deletingEditor;
    const preserveReviewComposer = Boolean(reviewNoteText.value.trim());
    const saved = await persistDocument({
      ...current.document,
      annotations: current.document.annotations.filter(
        (candidate) => candidate.id !== annotation.id,
      ),
      reviewState: "in-progress",
    });
    if (!saved) return;

    if (deletingEditor) {
      if (!preserveReviewComposer) {
        try {
          await cleanupCurrentDraftJournal();
        } catch {
          return;
        }
      }
      editorDirty.value = false;
      clearEditor(playheadMs.value);
    }
    if (
      (preserveOtherDraft || preserveReviewComposer) &&
      !(await reconcileCanonicalDraft())
    ) {
      return;
    }
    if (!preserveOtherDraft && !preserveReviewComposer && !deletingEditor) {
      try {
        await cleanupCurrentDraftJournal();
      } catch {
        return;
      }
    }
    publishCanonicalState();
  });
}

function syncExemplarTag(): void {
  const options = exemplarTagOptions.value;
  if (!options.some((tag) => tag.id === exemplarTagId.value)) {
    exemplarTagId.value = options[0]?.id ?? "";
  }
}

function resetExemplarComposer(): void {
  exemplarTagId.value = "";
  exemplarKind.value = "strong";
  syncExemplarTag();
}

function addExemplarRole(): void {
  if (!exemplarTagId.value || editorLocked.value) return;
  pauseForEdit();
  recordEditorUndo();
  const role = { kind: exemplarKind.value, tagId: exemplarTagId.value };
  draftExemplarRoles.value = sortExemplarRoles([
    ...draftExemplarRoles.value.filter((entry) => entry.tagId !== role.tagId),
    role,
  ]);
  markDraft();
}

function changeExemplarRoleKind(
  tagId: string,
  kind: GoldExemplarRoleKindV1,
): void {
  if (editorLocked.value) return;
  const hasLabel = draftLabels.value.some((label) => label.tagId === tagId);
  if ((kind === "counterexample") === hasLabel) return;
  pauseForEdit();
  recordEditorUndo();
  draftExemplarRoles.value = draftExemplarRoles.value.map((role) =>
    role.tagId === tagId ? { ...role, kind } : role,
  );
  markDraft();
}

function handleExemplarRoleKindChange(tagId: string, event: Event): void {
  const kind = (event.target as HTMLSelectElement).value;
  if (kind === "strong" || kind === "weak" || kind === "counterexample") {
    changeExemplarRoleKind(tagId, kind);
  }
}

function exemplarKindsForTag(tagId: string): readonly GoldExemplarRoleKindV1[] {
  return draftLabels.value.some((label) => label.tagId === tagId)
    ? ["strong", "weak"]
    : ["counterexample"];
}

function removeExemplarRole(tagId: string): void {
  if (editorLocked.value) return;
  pauseForEdit();
  recordEditorUndo();
  draftExemplarRoles.value = draftExemplarRoles.value.filter((role) => role.tagId !== tagId);
  markDraft();
}

function resetTaskQualityState(): void {
  cancelTagActivation();
  resetExemplarComposer();
  reviewNoteText.value = "";
  reviewNoteIncludeSelection.value = true;
  qualityMessage.value = "";
}

async function loadFoundationDetails(event: Event): Promise<void> {
  const details = event.currentTarget as HTMLDetailsElement;
  const currentDirectory = directory.value;
  if (!details.open || !currentDirectory || foundationDetailsBusy.value) return;
  const digest = currentDirectory.manifest.currentFoundation.sha256;
  if (foundationDetailsDigest.value === digest) return;

  foundationDetailsBusy.value = true;
  foundationDetailsMessage.value = "Loading canonical exemplar roles";
  try {
    const scans = await currentDirectory.scanAnnotations();
    const blocked = scans.find((entry) => entry.status !== "ok");
    if (blocked) throw new Error(`Could not read ${blocked.filename}`);
    foundationExemplarViews.value = scans.flatMap((entry) =>
      entry.status === "ok"
        ? entry.document.annotations.flatMap((annotation) =>
            annotation.exemplarRoles.map((role) => ({
              annotationId: annotation.id,
              kind: role.kind,
              range: annotation.range,
              sourceLabel: `${entry.document.source.title} · ${entry.document.source.difficulty}`,
              tagId: role.tagId,
            })),
          )
        : [],
    );
    foundationDetailsDigest.value = digest;
    foundationDetailsMessage.value = foundationExemplarViews.value.length
      ? "Canonical exemplar roles"
      : "No canonical exemplar roles yet";
  } catch (error) {
    foundationDetailsMessage.value = errorMessage(error);
  } finally {
    foundationDetailsBusy.value = false;
  }
}

function exemplarViewsForTag(tagId: string): readonly FoundationExemplarView[] {
  return foundationExemplarViews.value.filter((entry) => entry.tagId === tagId);
}

async function addReviewNote(): Promise<void> {
  const current = session.value;
  if (!current || !directory.value || draftCleanupBlocked.value) return;
  await runWorkspaceOperation(workspaceLifecycle, "quality-update", async () => {
    await finalizeActiveGestures();
    const active = session.value;
    if (!active) return;
    const range = reviewNoteIncludeSelection.value ? readDraftRange(false) : undefined;
    if (reviewNoteIncludeSelection.value && !range) {
      qualityMessage.value = "Fix the selection range before attaching it to a review note.";
      return;
    }

    qualityMessage.value = "Saving review note";
    try {
      const noteRefs = reviewNoteIncludeSelection.value
        ? [...selectedNoteIds.value].flatMap((id) => {
            const reference = active.noteRefs.get(id);
            return reference ? [reference] : [];
          })
        : [];
      const document = addReviewNoteV1(active.document, {
        ...(range ? { range } : {}),
        ...(noteRefs.length > 0 ? { noteRefs } : {}),
        text: reviewNoteText.value,
      });
      const saved = await persistDocument(document);
      if (!saved) {
        qualityMessage.value = saveMessage.value;
        return;
      }
      reviewNoteText.value = "";
      if (!(await reconcileCanonicalDraft())) {
        qualityMessage.value = saveMessage.value;
        return;
      }
      publishCanonicalState();
      qualityMessage.value = "Open review note saved outside training exports";
    } catch (error) {
      qualityMessage.value = errorMessage(error);
    }
  });
}

async function resolveReviewNote(noteId: string): Promise<void> {
  const current = session.value;
  if (!current || !directory.value || draftCleanupBlocked.value) return;
  await runWorkspaceOperation(workspaceLifecycle, "quality-update", async () => {
    await finalizeActiveGestures();
    const active = session.value;
    if (!active) return;
    qualityMessage.value = "Resolving review note";
    try {
      const document = resolveReviewNoteV1(active.document, { id: noteId });
      const saved = await persistDocument(document);
      if (saved && (await reconcileCanonicalDraft())) {
        publishCanonicalState();
        qualityMessage.value = "Review note resolved";
      } else {
        qualityMessage.value = saveMessage.value;
      }
    } catch (error) {
      qualityMessage.value = errorMessage(error);
    }
  });
}

function seekReviewNote(noteId: string): void {
  const range = reviewNotes.value.find((note) => note.id === noteId)?.range;
  if (range) seekPlayhead(range.startMs);
}

async function markChartComplete(): Promise<void> {
  const current = session.value;
  if (!current || !directory.value || draftCleanupBlocked.value) return;
  await runWorkspaceOperation(workspaceLifecycle, "quality-update", async () => {
    await finalizeActiveGestures();
    const active = session.value;
    if (!active) return;
    const completion = completeAnnotationDocumentV1(active.document, {
      hasUncommittedDraft: hasUncommittedDraft.value,
    });
    if (!completion.ok) {
      qualityMessage.value = completion.blockers.map(completionBlockerText).join(" · ");
      return;
    }

    qualityMessage.value = "Verifying chart completion";
    const saved = await persistDocument(completion.document);
    if (!saved || !(await reconcileCanonicalDraft())) {
      qualityMessage.value = saveMessage.value;
      return;
    }
    publishCanonicalState();
    qualityMessage.value = "Chart marked complete";
  });
}

async function previewGoldRelease(): Promise<void> {
  const currentDirectory = directory.value;
  if (!currentDirectory) return;
  await runWorkspaceOperation(workspaceLifecycle, "release-preview", async () => {
    await finalizeActiveGestures();
    releaseMessage.value = "Flushing drafts and scanning verified canonical sidecars";
    try {
      await flushDraft();
      releasePreview.value = await buildGoldRelease(currentDirectory, sessions);
      releaseMessage.value = hasUncommittedDraft.value
        ? "Preview ready · this in-progress chart draft is excluded"
        : "Preview ready · confirm to write this exact artifact";
    } catch (error) {
      releasePreview.value = undefined;
      releaseMessage.value = errorMessage(error);
    }
  });
}

async function confirmGoldRelease(): Promise<void> {
  const currentDirectory = directory.value;
  if (!(currentDirectory instanceof FileSystemDatasetDirectory)) {
    return;
  }
  await runWorkspaceOperation(workspaceLifecycle, "release-confirm", async () => {
    await finalizeActiveGestures();
    const artifact = releasePreview.value;
    if (!artifact) return;
    releaseMessage.value = "Rechecking canonical sidecars before export";
    try {
      await flushDraft();
      const currentArtifact = await buildGoldRelease(
        currentDirectory,
        sessions,
        artifact.manifest.exportedAt,
      );
      if (!sameGoldReleaseArtifact(artifact, currentArtifact)) {
        releasePreview.value = currentArtifact;
        releaseMessage.value = "Canonical data changed · refreshed preview requires confirmation";
        return;
      }
      releaseMessage.value = "Writing release and verifying read-back";
      const written = await writeGoldRelease(currentDirectory.root, artifact);
      releasePreview.value = undefined;
      releaseMessage.value = `Release ${written.releaseId} verified in exports/`;
    } catch (error) {
      releaseMessage.value = errorMessage(error);
    }
  });
}

function invalidateReleasePreview(): void {
  if (!releasePreview.value) return;
  releasePreview.value = undefined;
  releaseMessage.value = "Release preview invalidated by newer canonical data";
}

async function persistDocument(
  document: AnnotationDocumentV1,
): Promise<boolean> {
  if (
    !session.value ||
    !directory.value ||
    !activeTaskId.value
  ) {
    return false;
  }
  const savingSession = session.value;
  const savingDirectory = directory.value;
  const savingTaskId = activeTaskId.value;
  saveState.value = "saving";
  saveMessage.value = "Writing canonical sidecar";
  try {
    await flushDraft();
    const result = await savingDirectory.saveAnnotation(document, draftBase.value, {
      sourceBytes: savingSession.sourceBytes,
      chart: savingSession.chart,
      inspected: { chart: savingSession.chart, source: savingSession.source },
      noteRefIndex: savingSession.noteRefIndex,
      hasUncommittedDraft: hasUncommittedDraft.value,
    });
    if (result.status === "conflict") {
      saveState.value = "conflict";
      saveMessage.value = "Save conflict. Local draft preserved";
      queue.value = updateQueueItemStatus(
        queue.value,
        savingTaskId,
        "save-conflict",
        saveMessage.value,
      );
      return false;
    }

    draftBase.value = result.version;
    const { restoredDraft: _, ...currentSession } = savingSession;
    session.value = {
      ...currentSession,
      document: result.document,
      base: result.version,
    };
    saveMessage.value = `Revision ${result.version.revision} verified · reconciling draft journal`;
    foundationDetailsDigest.value = undefined;
    invalidateReleasePreview();
    queue.value = updateQueueItemStatus(
      queue.value,
      savingTaskId,
      result.document.reviewState,
    );
    return true;
  } catch (error) {
    saveState.value = "error";
    saveMessage.value = errorMessage(error);
    queue.value = updateQueueItemStatus(
      queue.value,
      savingTaskId,
      "save-error",
      saveMessage.value,
    );
    return false;
  }
}

function markDraft(scheduleAutosave = true): void {
  if (
    !session.value ||
    !directory.value ||
    !activeTaskId.value ||
    editorLocked.value
  ) {
    return;
  }
  transitionDraft(scheduleAutosave);
}

function transitionDraft(scheduleAutosave = true): void {
  const taskId = activeTaskId.value;
  if (!taskId) return;
  editorDirty.value = true;
  workspaceLifecycle.draftLifecycle = "pending";
  invalidateReleasePreview();
  saveMessage.value = "Draft journal pending";
  if (activeTask.value?.status !== "draft") {
    queue.value = updateQueueItemStatus(queue.value, taskId, "draft");
  }
  if (draftTimer !== undefined) window.clearTimeout(draftTimer);
  if (!scheduleAutosave) {
    draftTimer = undefined;
    return;
  }
  draftTimer = window.setTimeout(() => {
    draftTimer = undefined;
    void persistDraftNow().catch(() => {});
  }, 160);
}

function markReviewNoteDraft(): void {
  if (!session.value || !directory.value || !activeTaskId.value || editorLocked.value) return;
  invalidateReleasePreview();
  if (!hasUncommittedDraft.value) {
    if (draftTimer !== undefined) {
      window.clearTimeout(draftTimer);
      draftTimer = undefined;
    }
    void cleanupCurrentDraftJournal()
      .then(() => {
        if (!hasUncommittedDraft.value) publishCanonicalState();
      })
      .catch(() => {});
    return;
  }
  workspaceLifecycle.draftLifecycle = "pending";
  saveMessage.value = "Draft journal pending";
  queue.value = updateQueueItemStatus(queue.value, activeTaskId.value, "draft");
  if (draftTimer !== undefined) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    draftTimer = undefined;
    void persistDraftNow(true).catch(() => {});
  }, 160);
}

async function persistDraftNow(force = false): Promise<void> {
  if (!session.value || !directory.value || (!hasUncommittedDraft.value && !force)) return;
  const draft = buildDraft(session.value, directory.value.manifest.datasetId);
  try {
    await draftJournal.write(() => sessions.putDraft(draft));
    if (saveState.value === "error") {
      saveState.value = session.value.base ? "saved" : "idle";
    }
    saveMessage.value = "Draft journal saved";
    if (activeTaskId.value) {
      queue.value = updateQueueItemStatus(queue.value, activeTaskId.value, "draft");
    }
  } catch (error) {
    if (workspaceLifecycle.draftLifecycle === "write-error") {
      reportDraftJournalError("Draft journal write failed", error);
    }
    throw error;
  }
}

async function flushDraft(): Promise<void> {
  await finalizeActiveGestures();
  const hadTimer = draftTimer !== undefined;
  if (draftTimer !== undefined) {
    window.clearTimeout(draftTimer);
    draftTimer = undefined;
  }
  if (workspaceLifecycle.draftLifecycle === "cleanup-error") {
    throw new Error("Discard the local draft to finish journal cleanup before continuing.");
  }
  if (
    hasUncommittedDraft.value &&
    (hadTimer ||
      workspaceLifecycle.draftLifecycle === "write-error" ||
      workspaceLifecycle.draftLifecycle === "clean")
  ) {
    await persistDraftNow(true);
  }
  await draftJournal.pending;
}

async function discardDraft(): Promise<void> {
  const current = session.value;
  const currentDirectory = directory.value;
  const taskId = activeTaskId.value;
  if (!current || !currentDirectory || !taskId || !draftRecoveryVisible.value) {
    return;
  }
  await runWorkspaceOperation(workspaceLifecycle, "discard-draft", async () => {
    pauseForEdit();
    await finalizeActiveGestures();
    if (draftTimer !== undefined) {
      window.clearTimeout(draftTimer);
      draftTimer = undefined;
    }

    saveState.value = "saving";
    saveMessage.value = "Discarding local draft";
    try {
      await draftJournal.pending.catch(() => {});
      await cleanupCurrentDraftJournal();
    } catch (error) {
      saveMessage.value = `Draft not discarded: ${errorMessage(error)}`;
      return;
    }

    draftBase.value = current.base;
    reviewNoteText.value = "";
    reviewNoteIncludeSelection.value = true;
    pendingTextUndo = undefined;
    resetTaskQualityState();
    editorDirty.value = false;
    clearEditor(playheadMs.value);
    queue.value = updateQueueItemStatus(
      queue.value,
      taskId,
      current.base ? current.document.reviewState : "unseen",
    );
    saveState.value = current.base ? "saved" : "idle";
    saveMessage.value = current.base
      ? `Draft discarded · revision ${current.base.revision} unchanged`
      : "Draft discarded · chart remains unseen";
    invalidateReleasePreview();
  });
}

async function discardReadonlyDraft(): Promise<void> {
  const task = readonlyTask.value;
  const currentDirectory = directory.value;
  if (!task?.source || !currentDirectory || !readonlyDraftPresent.value) return;
  const sourceSha256 = task.source.sha256;

  await runWorkspaceOperation(workspaceLifecycle, "discard-draft", async () => {
    taskError.value = "";
    try {
      await draftJournal.pending.catch(() => {});
      await draftJournal.cleanup(() =>
        sessions.deleteDraft(currentDirectory.manifest.datasetId, sourceSha256),
      );
      readonlyDraftPresent.value = false;
      saveMessage.value = `Annotation v${task.future?.version ?? "?"} · read-only · old draft discarded`;
    } catch (error) {
      taskError.value = `Draft not discarded: ${errorMessage(error)}`;
    }
  });
}

async function cleanupCurrentDraftJournal(): Promise<void> {
  const current = session.value;
  const currentDirectory = directory.value;
  if (!current || !currentDirectory) return;
  try {
    await draftJournal.cleanup(() =>
      sessions.deleteDraft(currentDirectory.manifest.datasetId, current.source.sha256),
    );
  } catch (error) {
    if (workspaceLifecycle.draftLifecycle === "cleanup-error") {
      reportDraftJournalError("Draft journal cleanup failed", error);
    }
    throw error;
  }
}

async function reconcileCanonicalDraft(): Promise<boolean> {
  try {
    if (hasUncommittedDraft.value) await persistDraftNow(true);
    else await cleanupCurrentDraftJournal();
    return true;
  } catch {
    return false;
  }
}

function reportDraftJournalError(prefix: string, error: unknown): void {
  saveState.value = "error";
  saveMessage.value = `${prefix}: ${errorMessage(error)}`;
  if (activeTaskId.value) {
    queue.value = updateQueueItemStatus(
      queue.value,
      activeTaskId.value,
      "save-error",
      saveMessage.value,
    );
  }
}

function publishCanonicalState(message?: string): void {
  const current = session.value;
  if (!current) return;
  saveState.value = current.base ? "saved" : "idle";
  saveMessage.value = current.base
    ? (message ??
      (workspaceLifecycle.draftLifecycle === "stored"
        ? `Revision ${current.base.revision} verified · draft journal saved`
        : `Revision ${current.base.revision} verified`))
    : (message ?? "Local draft only");
  if (
    activeTaskId.value &&
    workspaceLifecycle.draftLifecycle === "clean" &&
    !hasUncommittedDraft.value
  ) {
    queue.value = updateQueueItemStatus(
      queue.value,
      activeTaskId.value,
      current.document.reviewState,
    );
  }
}

function buildDraft(current: BeatmapSession, datasetId: string): AnnotationDraft {
  return {
    annotationEditorDirty: editorDirty.value,
    base: draftBase.value,
    datasetId,
    editorText: judgmentNote.value,
    ...(editingAnnotationId.value
      ? { editingAnnotationId: editingAnnotationId.value }
      : {}),
    labels: draftLabels.value,
    exemplarRoles: draftExemplarRoles.value,
    noteRefs: [...selectedNoteIds.value].flatMap((id) => {
      const ref = current.noteRefs.get(id);
      return ref ? [ref] : [];
    }),
    playheadMs: playheadMs.value,
    range: readDraftRange(false),
    rangeEditor: { start: draftStart.value, end: draftEnd.value },
    reviewNoteIncludeSelection: reviewNoteIncludeSelection.value,
    reviewNoteText: reviewNoteText.value,
    sourceSha256: current.source.sha256,
    undoState: editorUndoStack.value,
    visualSpeed: visualSpeed.value,
  };
}

function clearEditor(startMs: number): void {
  if (!session.value) return;
  const range = boundedRange(startMs, startMs + 1_000, session.value.chartEndMs);
  editingAnnotationId.value = undefined;
  draftStart.value = formatMs(range.startMs);
  draftEnd.value = formatMs(range.endMs);
  draftLabels.value = [];
  draftExemplarRoles.value = [];
  judgmentNote.value = "";
  manualExclusions.value = new Set();
  focusedTagId.value = undefined;
  editorUndoStack.value = [];
  resetExemplarComposer();
  selectAllCandidates(range);
  rangeError.value = "";
  editorDirty.value = false;
}

function selectAllCandidates(range: TimeRangeV1): void {
  if (!session.value) return;
  selectedNoteIds.value = new Set(
    rangeCandidates(session.value.chart, range).map((note) => note.id),
  );
}

function readDraftRange(reportError: boolean): TimeRangeV1 | null {
  if (!session.value) return null;
  const startMs = parseTime(draftStart.value);
  const endMs = parseTime(draftEnd.value);
  const message =
    startMs === undefined || endMs === undefined
      ? "Use milliseconds or mm:ss.mmm."
      : startMs < 0 || endMs > session.value.chartEndMs
        ? `Range must stay inside 0 to ${formatMs(session.value.chartEndMs)} ms.`
        : startMs >= endMs
          ? "Range end must be later than its start."
          : "";
  if (reportError) rangeError.value = message;
  return message ? null : { startMs: startMs as number, endMs: endMs as number };
}

function filterTags(status: FoundationTagV1["status"]): readonly FoundationTagV1[] {
  if (!session.value) return [];
  const query = tagQuery.value.trim().toLowerCase();
  return session.value.foundation.tags.filter(
    (tag) =>
      tag.status === status &&
      (!query ||
        tag.id.includes(query) ||
        tag.displayName.toLowerCase().includes(query) ||
        tag.aliases.some((alias) => alias.toLowerCase().includes(query))),
  );
}

async function openOrCreateDataset(
  handle: BrowserDirectoryHandle,
  selectedCatalog: CatalogSource,
  creatorId: string,
): Promise<FileSystemDatasetDirectory | ReadonlyFutureDatasetDirectory> {
  if (await hasDatasetManifest(handle)) return openDatasetDirectoryAnyVersion(handle);
  const createdAt = new Date().toISOString();
  const foundation = bootstrapFoundationV1({
    foundationId: crypto.randomUUID(),
    creatorId,
    createdAt,
    catalogTags: selectedCatalog.categories,
  });
  return createDatasetDirectory(handle, {
    name: datasetName.value.trim() || "Section gold v1",
    catalogSources: [
      { url: selectedCatalog.source, csvSha256: selectedCatalog.sha256 },
    ],
    foundation,
  });
}

async function hasDatasetManifest(handle: BrowserDirectoryHandle): Promise<boolean> {
  try {
    await handle.getFileHandle("dataset.json");
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
}

async function runSetupAction(action: () => Promise<void>): Promise<void> {
  setupError.value = "";
  try {
    await action();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setupError.value = errorMessage(error);
  }
}

function initialRange(current: BeatmapSession): TimeRangeV1 {
  const startMs = current.chart.notes[0]?.startTime ?? 0;
  return boundedRange(startMs, startMs + 1_000, current.chartEndMs);
}

function boundedRange(startMs: number, endMs: number, chartEndMs: number): TimeRangeV1 {
  const boundedStart = Math.min(Math.max(0, startMs), Math.max(0, chartEndMs - 1));
  return {
    startMs: boundedStart,
    endMs: Math.min(chartEndMs, Math.max(boundedStart + 1, endMs)),
  };
}

function parseTime(value: string): number | undefined {
  const result = parseTimeInput(value);
  return result.ok ? result.valueMs : undefined;
}

function formatMs(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const milliseconds = Math.floor(value % 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function rangeOverviewGeometry(
  range: TimeRangeV1,
  chartEndMs: number,
  clip = false,
): { x: number; width: number } {
  const startMs = clip ? Math.min(Math.max(0, range.startMs), chartEndMs) : range.startMs;
  const endMs = clip ? Math.min(Math.max(0, range.endMs), chartEndMs) : range.endMs;
  return {
    x: (startMs / chartEndMs) * 1_000,
    width: Math.max(1, ((endMs - startMs) / chartEndMs) * 1_000),
  };
}

function rangeSceneGeometry(
  range: TimeRangeV1,
  frame: BufferedSceneFrame,
): { x: number; y: number; width: number; height: number } | undefined {
  const startMs = Math.max(range.startMs, frame.bufferRange.startMs);
  const endMs = Math.min(range.endMs, frame.bufferRange.endMs);
  if (startMs >= endMs) return undefined;
  const pixelsPerMillisecond = frame.scene.timeRange.pixelsPerMillisecond;
  return {
    x: frame.scene.padding.left,
    y:
      frame.scene.padding.top +
      (startMs - frame.bufferRange.startMs) * pixelsPerMillisecond,
    width:
      frame.scene.width - frame.scene.padding.left - frame.scene.padding.right,
    height: Math.max(1, (endMs - startMs) * pixelsPerMillisecond),
  };
}

function formatMetric(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}

function statusLabel(status: TaskQueueStatus): string {
  return status.replaceAll("-", " ");
}

function linesFromText(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function sortExemplarRoles(
  roles: readonly GoldExemplarRoleV1[],
): readonly GoldExemplarRoleV1[] {
  return [...roles].sort((left, right) => left.tagId.localeCompare(right.tagId));
}

function completionBlockerText(
  blocker: "open-review-note" | "pending-prediction" | "uncommitted-draft",
): string {
  if (blocker === "uncommitted-draft") return "Commit or clear the current draft first";
  if (blocker === "open-review-note") return "Resolve every open review note";
  return "Review every pending silver prediction";
}

function setSetupError(message: string): void {
  setupError.value = message;
}

function setRangeError(message: string): void {
  rangeError.value = message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
</script>

<template>
  <main id="main-content" class="bench annotation-bench" tabindex="-1">
    <header class="app-bar annotation-app-bar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true"></span>
        <div>
          <p class="brand-name">Beatmap Lens</p>
          <p class="brand-edition">Section annotation</p>
        </div>
      </div>

      <div class="annotation-chart-context">
        <span>{{ directory?.manifest.name ?? futureDataset?.manifest.name ?? "Local dataset" }}</span>
        <strong>{{ currentChartLabel }}</strong>
      </div>

      <WorkspaceModeSwitch
        model-value="annotate"
        :disabled="operationLocked || draftCleanupBlocked"
        @update:model-value="changeWorkspaceMode"
      />

      <div class="annotation-toolbar-status">
        <span v-if="directory" class="queue-progress">
          {{ progress.complete }} / {{ progress.total }} complete
        </span>
        <span class="health-status" :class="`health-status--${saveTone}`" aria-live="polite">
          <span class="health-dot" aria-hidden="true"></span>
          {{ saveMessage }}
        </span>
      </div>
    </header>

    <section
      v-if="futureDataset"
      class="annotation-onboarding annotation-readonly"
      aria-labelledby="readonly-heading"
    >
      <div class="onboarding-intro">
        <p class="section-kicker"><span class="section-number">RO</span> Future contract</p>
        <h1 id="readonly-heading">Opened read-only</h1>
        <p>
          Dataset contract v{{ futureDataset.manifest.version }} is newer than this Inspector. Its
          files are visible here and cannot be overwritten by v1 code.
        </p>
      </div>
      <div class="readonly-summary">
        <div class="readonly-dataset-fact">
          <span>Dataset</span>
          <strong>{{ futureDataset.manifest.name ?? futureDataset.manifest.datasetId ?? "Unnamed" }}</strong>
        </div>
        <div class="readonly-dataset-fact">
          <span>Annotation files</span>
          <strong>{{ futureScanMessage ? "Unknown" : futureEntries.length }}</strong>
        </div>
        <p v-if="futureScanMessage" class="inline-message">{{ futureScanMessage }}</p>
        <ol class="readonly-file-list">
          <li v-for="entry in futureEntries" :key="entry.filename">
            <span>{{ entry.filename.slice(0, 12) }}</span>
            <strong>{{ entry.status.replaceAll("-", " ") }}</strong>
          </li>
        </ol>
        <button
          class="button button--quiet"
          type="button"
          @click="futureDataset = undefined; futureScanMessage = ''"
        >
          Choose another dataset
        </button>
      </div>
    </section>

    <section v-else-if="!directory" class="annotation-onboarding" aria-labelledby="onboarding-heading">
      <div class="onboarding-intro">
        <p class="section-kicker"><span class="section-number">01</span> Local expert workspace</p>
        <h1 id="onboarding-heading">Prepare an annotation session</h1>
        <p>
          Canonical gold stays in a directory you choose. Source bytes and paths never enter the
          dataset contract.
        </p>
        <dl class="onboarding-policies">
          <div>
            <dt>Coordinates</dt>
            <dd>Source ms · [start, end)</dd>
          </div>
          <div>
            <dt>Judgment</dt>
            <dd>Multi-label, positive-only</dd>
          </div>
          <div>
            <dt>Audio</dt>
            <dd>Optional context</dd>
          </div>
        </dl>
      </div>

      <form class="onboarding-form" @submit.prevent="startWorkspace">
        <div v-if="!fileSystemSupported" class="inline-message inline-message--error">
          Section annotation requires Chromium's File System Access API.
        </div>

        <label class="field-stack">
          <span>Pseudonymous annotator ID</span>
          <input v-model="annotatorId" autocomplete="off" placeholder="expert-lantern" />
        </label>

        <label class="field-stack">
          <span>Dataset name for a new directory</span>
          <input v-model="datasetName" autocomplete="off" />
        </label>

        <div class="setup-picker-row">
          <div>
            <strong>Dataset directory</strong>
            <span>{{ datasetHandle?.name ?? "Not selected" }}</span>
          </div>
          <button class="button button--quiet" type="button" @click="chooseDataset">
            Select
          </button>
        </div>

        <div class="setup-picker-row">
          <div>
            <strong>Catalog manifest</strong>
            <span>{{ catalogHandle?.name ?? "beatmap-pattern-categories.json" }}</span>
          </div>
          <button class="button button--quiet" type="button" @click="chooseCatalog">
            Select
          </button>
        </div>

        <div class="setup-picker-row">
          <div>
            <strong>Mapped corpus directory</strong>
            <span>{{ corpusHandle?.name ?? "Not selected" }}</span>
          </div>
          <button class="button button--quiet" type="button" @click="chooseCorpus">
            Select
          </button>
        </div>

        <p v-if="setupRestored" class="setup-note">
          Stored directory handles were restored. Starting the workspace requests permission only if
          Chromium no longer grants it.
        </p>
        <p v-if="setupError" class="inline-message inline-message--error" role="alert">
          {{ setupError }}
        </p>
        <p v-else-if="setupProgress" class="inline-message" aria-live="polite">
          {{ setupProgress }}
        </p>

        <button
          class="button button--primary onboarding-submit"
          type="submit"
          :disabled="setupBusy || !fileSystemSupported"
        >
          {{ setupBusy ? "Opening workspace" : "Open workspace" }}
        </button>
      </form>
    </section>

    <template v-else>
      <nav class="mobile-view-switcher" aria-label="Annotation workspace views">
        <button
          v-for="panel in (['source', 'preview', 'details'] as const)"
          :key="panel"
          class="mobile-view-button"
          :class="{ 'is-active': activeMobilePanel === panel }"
          type="button"
          :aria-pressed="activeMobilePanel === panel"
          @click="activeMobilePanel = panel"
        >
          {{ panel }}
        </button>
      </nav>

      <div class="annotation-workspace">
        <aside
          class="annotation-rail annotation-source-rail"
          :class="{ 'is-mobile-active': activeMobilePanel === 'source' }"
          aria-labelledby="queue-heading"
        >
          <header class="annotation-rail-header">
            <div>
              <p class="section-kicker"><span class="section-number">01</span> Task queue</p>
              <h2 id="queue-heading">Catalog charts</h2>
            </div>
            <span class="rail-count">{{ queue.length }}</span>
          </header>

          <nav class="task-list" aria-label="Catalog tasks">
            <button
              v-for="task in queue"
              :key="task.id"
              class="task-row"
              :class="{ 'is-active': task.id === activeTaskId }"
              type="button"
              :disabled="task.status === 'missing-source' || operationLocked || draftCleanupBlocked"
              @click="openTask(task)"
            >
              <span class="task-status-mark" :class="`task-status-mark--${task.status}`" aria-hidden="true"></span>
              <span class="task-copy">
                <strong>{{ task.source?.title ?? task.displayName }}</strong>
                <span>{{ task.source?.difficulty ?? task.error ?? task.displayName }}</span>
              </span>
              <span class="task-status-label">{{ statusLabel(task.status) }}</span>
            </button>
          </nav>

          <section v-if="activeTask" class="rail-section" aria-labelledby="hints-heading">
            <h3 id="hints-heading">Catalog hints</h3>
            <div class="suggestion-list">
              <span v-for="tag in activeTask.task.categories" :key="tag" class="tag-chip tag-chip--hint">
                {{ tag }}
              </span>
            </div>
          </section>

          <section v-if="session" class="rail-section" aria-labelledby="facts-heading">
            <h3 id="facts-heading">Chart facts</h3>
            <dl class="compact-facts">
              <div><dt>Keys</dt><dd>{{ session.source.keyCount }}K</dd></div>
              <div><dt>Notes</dt><dd>{{ session.source.noteCount }}</dd></div>
              <div><dt>Duration</dt><dd>{{ formatTime(session.chartEndMs) }}</dd></div>
              <div><dt>Creator</dt><dd>{{ session.source.creator }}</dd></div>
            </dl>
          </section>

          <details v-if="session" class="source-details">
            <summary>Read-only source</summary>
            <pre>{{ session.sourceText }}</pre>
          </details>
        </aside>

        <section
          class="annotation-stage"
          :class="{ 'is-mobile-active': activeMobilePanel === 'preview' }"
          aria-labelledby="stage-heading"
        >
          <header class="annotation-stage-header">
            <div>
              <p class="section-kicker"><span class="section-number">02</span> Section evidence</p>
              <h1 id="stage-heading">{{ session?.source.title ?? readonlyTask?.source?.title ?? "Select a chart" }}</h1>
              <p v-if="session || readonlyTask?.source" class="chart-byline">
                <strong>{{ session?.source.artist ?? readonlyTask?.source?.artist }}</strong>
                <span aria-hidden="true">·</span>
                {{ session?.source.difficulty ?? readonlyTask?.source?.difficulty }}
              </p>
            </div>
            <div v-if="session" class="playhead-readout">
              <span>Playhead</span>
              <strong>{{ formatTime(playheadMs) }}</strong>
            </div>
          </header>

          <div v-if="taskError" class="stage-message inline-message--error" role="alert">
            {{ taskError }}
          </div>
          <div v-else-if="taskLoading" class="stage-message">Loading exact source bytes</div>
          <div v-else-if="readonlyTask" class="stage-message readonly-task-panel">
            <span class="readonly-badge">Read-only</span>
            <strong>Annotation contract v{{ readonlyTask.future?.version ?? "?" }}</strong>
            <p>
              This sidecar was written by a newer Inspector. Its source identity and revision are
              visible, but editing is disabled so the newer contract cannot be overwritten.
            </p>
            <dl class="compact-facts">
              <div><dt>Revision</dt><dd>{{ readonlyTask.future?.revision ?? "Unknown" }}</dd></div>
              <div><dt>Source SHA</dt><dd>{{ readonlyTask.source?.sha256.slice(0, 12) }}</dd></div>
            </dl>
            <button
              v-if="readonlyDraftPresent"
              class="button button--quiet"
              type="button"
              :disabled="operationLocked"
              @click="discardReadonlyDraft"
            >
              Discard incompatible local draft
            </button>
          </div>
          <div v-else-if="session" class="interactive-stage-shell">
            <div class="falling-note-shell">
              <svg
                ref="viewportSvg"
                class="falling-note-viewport"
                :class="{ 'is-locked': operationLocked }"
                :viewBox="`0 0 ${viewportSize.width} ${viewportSize.height}`"
                role="img"
                :aria-label="`${session.source.keyCount}K falling-note evidence. Drag to select, Shift-drag to scrub, or hold Alt for free placement.`"
                @pointerdown="beginViewportGesture"
                @pointermove="moveViewportGesture"
                @pointerup="endViewportGesture"
                @pointercancel="endViewportGesture"
              >
                <title>Interactive falling-note evidence</title>
                <defs>
                  <pattern
                    id="annotation-saved-hatch"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line x1="0" y1="0" x2="0" y2="10" class="saved-hatch-line" />
                  </pattern>
                  <pattern
                    id="annotation-selection-hatch"
                    width="12"
                    height="12"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line x1="0" y1="0" x2="0" y2="12" class="selection-hatch-line" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" class="viewport-ground" />
                <g v-if="viewportFrame" class="viewport-lanes" aria-hidden="true">
                  <rect
                    v-for="entry in viewportFrame.keyedLanes"
                    :key="entry.key"
                    :x="entry.lane.x"
                    y="0"
                    :width="entry.lane.width"
                    :height="viewportSize.height"
                    :fill="entry.lane.fill"
                    :stroke="entry.lane.stroke"
                  />
                </g>
                <g
                  v-if="viewportFrame"
                  class="moving-note-group"
                  :transform="viewportFrame.noteGroupTransform"
                >
                  <!-- biome-ignore lint/a11y/noStaticElementInteractions: Saved ranges are also keyboard accessible in the annotation list. -->
                  <rect
                    v-for="band in annotationBands"
                    :key="`saved-${band.annotation.id}`"
                    class="viewport-range-band viewport-range-band--saved"
                    :x="band.x"
                    :y="band.y"
                    :width="band.width"
                    :height="band.height"
                    @pointerdown.stop
                    @click.stop="seekAnnotation(band.annotation)"
                  />
                  <rect
                    v-if="selectionBand"
                    class="viewport-range-band viewport-range-band--selection"
                    :x="selectionBand.x"
                    :y="selectionBand.y"
                    :width="selectionBand.width"
                    :height="selectionBand.height"
                    aria-hidden="true"
                  />
                  <!-- biome-ignore lint/a11y/noStaticElementInteractions: Note selection is duplicated by the keyboard-accessible checkbox list. -->
                  <rect
                    v-for="entry in viewportFrame.keyedNotes"
                    :key="entry.key"
                    class="falling-note"
                    :class="{
                      'is-candidate': candidateNoteIds.has(entry.glyph.id),
                      'is-selected': selectedNoteIds.has(entry.glyph.id),
                    }"
                    :x="entry.glyph.x"
                    :y="entry.glyph.y"
                    :width="entry.glyph.width"
                    :height="entry.glyph.height"
                    :rx="entry.glyph.radius"
                    :fill="entry.glyph.fill"
                    :stroke="entry.glyph.stroke"
                    @pointerdown.stop
                    @click.stop="toggleSceneNote(entry.glyph.id)"
                  />
                </g>
                <g class="judgment-guide" aria-hidden="true">
                  <line
                    x1="0"
                    :y1="viewportSize.height * judgmentLineRatio"
                    :x2="viewportSize.width"
                    :y2="viewportSize.height * judgmentLineRatio"
                  />
                  <text
                    x="12"
                    :y="viewportSize.height * judgmentLineRatio - 8"
                  >JUDGE · 82%</text>
                </g>
              </svg>
              <div v-if="viewportFrame && viewportInstrumentation" class="viewport-instrumentation">
                <span>BUF R{{ viewportFrame.revision }}</span>
                <span>{{ viewportFrame.refreshed ? "REFRESH" : "REUSE" }}</span>
                <span>
                  BUILD {{ viewportInstrumentation.sceneBuildCount }} · REUSE
                  {{ viewportInstrumentation.reusedFrameCount }}
                </span>
                <span>
                  N {{ viewportInstrumentation.lastRenderedNoteCount }} / MAX
                  {{ viewportInstrumentation.maximumRenderedNoteCount }}
                </span>
                <span>
                  BUILD {{ formatMetric(viewportInstrumentation.lastBuildDurationMs) }} /
                  {{ formatMetric(viewportInstrumentation.maximumBuildDurationMs) }} ms
                </span>
                <span>RAF P95 {{ formatMetric(frameP95Ms) }} ms</span>
              </div>
              <div class="viewport-legend" aria-hidden="true">
                <span><i class="legend-mark legend-mark--selected"></i>Selected</span>
                <span><i class="legend-mark legend-mark--saved"></i>Saved</span>
                <span>Drag select · Shift scrub · Alt free</span>
              </div>
            </div>

            <div class="overview-shell">
              <div class="overview-heading">
                <span>Whole-chart density</span>
                <strong>{{ selectedCount }} / {{ candidateNotes.length }} notes selected</strong>
              </div>
              <div class="overview-track">
                <svg
                  ref="overviewSvg"
                  class="overview-timeline"
                  viewBox="0 0 1000 72"
                  role="img"
                  aria-label="Chart density overview. Click to seek or drag empty space to create a range."
                  @pointerdown="beginTimelineDrag($event, 'create')"
                  @pointermove="moveTimelineDrag"
                  @pointerup="endTimelineDrag"
                  @pointercancel="endTimelineDrag"
                >
                <title>Whole-chart note density and annotation ranges</title>
                <rect width="1000" height="72" class="overview-ground" />
                <path v-if="overviewDensity" :d="overviewDensity.path" class="overview-density" />
                <rect
                  v-if="timelineViewport"
                  class="overview-viewport-window"
                  :x="timelineViewport.x"
                  y="0"
                  :width="timelineViewport.width"
                  height="72"
                  aria-hidden="true"
                />
                <!-- biome-ignore lint/a11y/noStaticElementInteractions: Saved ranges are duplicated by the keyboard-accessible annotation list. -->
                <rect
                  v-for="band in overviewAnnotationBands"
                  :key="`overview-${band.annotation.id}`"
                  class="overview-saved-range"
                  :x="band.x"
                  y="8"
                  :width="band.width"
                  height="56"
                  @pointerdown.stop
                  @click.stop="seekAnnotation(band.annotation)"
                />
                <g v-if="timelineSelection" class="overview-selection-range">
                  <g>
                    <rect
                      class="overview-range-hit"
                      :x="timelineSelection.x - timelineHandleHitWidth"
                      y="0"
                      :width="timelineHandleHitWidth"
                      height="72"
                      @pointerdown.stop="beginTimelineDrag($event, 'resize-start')"
                    />
                  </g>
                  <g>
                    <rect
                      class="overview-range-hit"
                      :x="timelineSelection.x + timelineSelection.width"
                      y="0"
                      :width="timelineHandleHitWidth"
                      height="72"
                      @pointerdown.stop="beginTimelineDrag($event, 'resize-end')"
                    />
                  </g>
                  <rect
                    class="overview-selection-body"
                    :x="timelineSelection.x"
                    y="10"
                    :width="timelineSelection.width"
                    height="52"
                    @pointerdown.stop="beginTimelineDrag($event, 'move')"
                  />
                  <g aria-hidden="true">
                    <rect
                      class="overview-range-handle"
                      :x="timelineSelection.x - 7"
                      y="3"
                      width="14"
                      height="66"
                    />
                    <rect
                      class="overview-range-handle"
                      :x="timelineSelection.x + timelineSelection.width - 7"
                      y="3"
                      width="14"
                      height="66"
                    />
                  </g>
                </g>
                <line
                  class="overview-playhead"
                  :x1="overviewPlayheadX"
                  y1="0"
                  :x2="overviewPlayheadX"
                  y2="72"
                />
                </svg>
              </div>
              <div class="overview-caption">
                <span>Click seek · drag empty create · drag band move · handles resize</span>
                <span>Hold Alt/Option for free placement</span>
              </div>
            </div>

            <div class="playback-strip">
              <fieldset class="transport-controls" aria-label="Playback controls">
                <button
                  class="transport-button transport-button--primary"
                  type="button"
                  :disabled="operationLocked"
                  :aria-pressed="playbackState.playing"
                  @click="togglePlayback"
                >
                  {{ playbackState.playing ? "Pause" : "Play" }}
                  <kbd>Space</kbd>
                </button>
                <button
                  class="transport-button"
                  type="button"
                  :disabled="operationLocked || !parsedRange"
                  @click="playSelectionOnce"
                >Selection <kbd>⇧Space</kbd></button>
                <button
                  class="transport-button"
                  :class="{ 'is-active': playbackState.looping }"
                  type="button"
                  :disabled="operationLocked || !parsedRange"
                  :aria-pressed="playbackState.looping"
                  @click="toggleSelectionLoop"
                >Loop <kbd>L</kbd></button>
                <button
                  class="transport-button"
                  :class="{ 'is-active': musicEnabled }"
                  type="button"
                  :disabled="operationLocked"
                  :aria-pressed="musicEnabled"
                  @click="toggleMusic"
                >Music {{ musicEnabled ? "On" : "Off" }}</button>
              </fieldset>
              <div class="speed-controls">
                <span>Visual speed</span>
                <div class="speed-presets">
                  <button
                    v-for="speed in visualSpeedPresets"
                    :key="speed"
                    type="button"
                    :class="{ 'is-active': visualSpeed === speed }"
                    :disabled="operationLocked"
                    @click="selectVisualSpeed(speed)"
                  >{{ speed }}</button>
                </div>
                <label class="speed-custom">
                  <span>Custom</span>
                  <input
                    v-model="visualSpeedDraft"
                    type="number"
                    :min="minimumVisualSpeed"
                    :max="maximumVisualSpeed"
                    step="1"
                    :disabled="operationLocked"
                    aria-label="Custom visual speed in pixels per second"
                    @change="applyVisualSpeed"
                    @keydown.enter.prevent="applyVisualSpeed"
                  />
                  <small>px/s</small>
                </label>
              </div>
              <div class="playback-meta">
                <strong>{{ formatTime(playheadMs) }}</strong>
                <span>I/O edges · 1/2 salience · [ ] saved · ⌘/Ctrl Z undo</span>
                <small
                  class="audio-status"
                  :class="`audio-status--${audioStatus.kind}`"
                  role="status"
                >{{ audioStatusText }}</small>
                <small v-if="visualSpeedError" role="alert">{{ visualSpeedError }}</small>
              </div>
            </div>
          </div>
          <div v-else class="stage-empty">
            Choose a resolvable chart from the task queue.
          </div>
        </section>

        <aside
          class="annotation-rail annotation-details-rail"
          :class="{ 'is-mobile-active': activeMobilePanel === 'details' }"
          aria-labelledby="selection-heading"
        >
          <header class="annotation-rail-header">
            <div>
              <p class="section-kicker"><span class="section-number">03</span> Gold judgment</p>
              <h2 id="selection-heading">
                {{ editingAnnotationId ? "Edit annotation" : "Selection editor" }}
              </h2>
            </div>
            <span class="rail-count">{{ annotationList.length }}</span>
          </header>

          <fieldset
            v-if="session"
            class="annotation-editor"
            :disabled="editorLocked"
          >
            <section class="editor-section" aria-labelledby="range-heading">
              <div class="editor-section-heading">
                <h3 id="range-heading">Range</h3>
                <span>[start, end)</span>
              </div>
              <div class="range-inputs">
                <label>
                  <span>Start ms</span>
                  <input
                    v-model="draftStart"
                    inputmode="decimal"
                    @focus="beginTextEdit"
                    @input="markDraft()"
                    @blur="finishRangeEdit"
                  />
                </label>
                <label>
                  <span>End ms</span>
                  <input
                    v-model="draftEnd"
                    inputmode="decimal"
                    @focus="beginTextEdit"
                    @input="markDraft()"
                    @blur="finishRangeEdit"
                  />
                </label>
              </div>
              <p v-if="rangeError" class="field-error" role="alert">{{ rangeError }}</p>
            </section>

            <section class="editor-section" aria-labelledby="notes-heading">
              <div class="editor-section-heading">
                <h3 id="notes-heading">Range notes</h3>
                <span>{{ selectedCount }} / {{ candidateNotes.length }} selected</span>
              </div>
              <div class="candidate-note-list">
                <label v-for="note in pagedRangeNotes" :key="note.id" class="candidate-note-row">
                  <input
                    type="checkbox"
                    :checked="selectedNoteIds.has(note.id)"
                    @change="toggleNote(note)"
                  />
                  <span>C{{ note.column + 1 }}</span>
                  <strong>{{ formatMs(note.startTime) }}</strong>
                  <small>{{ note.kind === "long" ? `LN to ${formatMs(note.endTime)}` : "rice" }}</small>
                </label>
              </div>
              <div v-if="rangeNotePageCount > 1" class="range-note-pagination">
                <button
                  type="button"
                  :disabled="rangeNotePage === 0"
                  @click="rangeNotePage--"
                >Previous</button>
                <span>Page {{ rangeNotePage + 1 }} / {{ rangeNotePageCount }}</span>
                <button
                  type="button"
                  :disabled="rangeNotePage + 1 >= rangeNotePageCount"
                  @click="rangeNotePage++"
                >Next</button>
              </div>
            </section>

            <section class="editor-section" aria-labelledby="tags-heading">
              <div class="editor-section-heading">
                <h3 id="tags-heading">Tags and salience</h3>
                <span>2 strong / 1 weak</span>
              </div>
              <p class="salience-rubric" lang="en">
                2 means dominant and diagnostic. 1 means supporting, mixed, partial, or transitional.
              </p>
              <input
                v-model="tagQuery"
                class="tag-search"
                type="search"
                placeholder="Find an active tag"
              />
              <button
                v-if="canCreateCustomTag"
                class="custom-tag-button"
                type="button"
                @click="beginCustomTagActivation"
              >Create and activate <strong>{{ customTagId }}</strong></button>
              <ul v-if="activeTags.length" class="tag-option-list" aria-label="Active Foundation tags">
                <li v-for="tag in activeTags" :key="tag.id">
                  <button class="tag-option" type="button" @click="addTag(tag)">
                    <span class="status-dot status-dot--active" aria-hidden="true"></span>
                    <strong>{{ tag.displayName }}</strong>
                    <small>{{ tag.id }}</small>
                  </button>
                </li>
              </ul>
              <p v-else class="empty-copy">
                This Foundation has no matching active tags. Create one with a definition and an
                inclusion cue before adding it to gold.
              </p>

              <div v-if="suggestedTags.length" class="catalog-suggestion-group">
                <span>Catalog suggestions</span>
                <div class="suggestion-list">
                  <button
                    v-for="suggestion in suggestedTags"
                    :key="suggestion.tagId"
                    class="tag-chip tag-chip--button"
                    type="button"
                    :disabled="suggestion.tag?.status === 'retired'"
                    :title="suggestion.tag?.status === 'active' ? 'Add active tag' : suggestion.tag?.status === 'retired' ? 'Retired tags cannot be reused' : 'Create this suggestion as an active tag'"
                    @click="useSuggestedTag(suggestion)"
                  >
                    {{ suggestion.displayName }} · {{ suggestion.tag?.status ?? "define" }}
                  </button>
                </div>
              </div>

              <form v-if="activationTag" class="activation-form" @submit.prevent="activateTag">
                <div class="activation-form-heading">
                  <span>{{ activationIsCustom ? "Create custom active tag" : "Define catalog suggestion" }}</span>
                  <strong>{{ activationTagId }}</strong>
                </div>
                <div class="activation-identity">
                  <label class="field-stack">
                    <span>Canonical ID</span>
                    <input
                      v-model="activationTagId"
                      required
                    />
                  </label>
                  <label class="field-stack">
                    <span>Display name</span>
                    <input v-model="activationDisplayName" required />
                  </label>
                </div>
                <label class="field-stack">
                  <span>Definition</span>
                  <textarea v-model="activationDefinition" rows="3" required></textarea>
                </label>
                <label class="field-stack">
                  <span>Inclusion cues · one per line</span>
                  <textarea v-model="activationInclusionCues" rows="3" required></textarea>
                </label>
                <label class="field-stack">
                  <span>Exclusion cues · optional, one per line</span>
                  <textarea v-model="activationExclusionCues" rows="2"></textarea>
                </label>
                <label class="field-stack">
                  <span>Aliases · optional, one per line</span>
                  <textarea v-model="activationAliases" rows="2"></textarea>
                </label>
                <label class="field-stack">
                  <span>Salience clarification · optional</span>
                  <textarea v-model="activationSalienceClarification" rows="2"></textarea>
                </label>
                <p v-if="activationError" class="field-error" role="alert">{{ activationError }}</p>
                <div class="activation-actions">
                  <button class="button button--quiet" type="button" @click="cancelTagActivation">
                    Cancel
                  </button>
                  <button class="button button--primary" type="submit" :disabled="activationBusy">
                    {{ activationBusy ? "Saving Foundation" : "Create active tag and add" }}
                  </button>
                </div>
              </form>

              <div class="selected-label-list">
                <div
                  v-for="label in draftLabels"
                  :key="label.tagId"
                  class="selected-label-row"
                  :class="{ 'is-focused': focusedTagId === label.tagId }"
                  @focusin="focusedTagId = label.tagId"
                >
                  <strong>{{ label.tagId }}</strong>
                  <div class="salience-switch" :aria-label="`${label.tagId} salience`">
                    <button
                      v-for="value in ([2, 1] as const)"
                      :key="value"
                      type="button"
                      :class="{ 'is-active': label.salience === value }"
                      :aria-pressed="label.salience === value"
                      @click="setSalience(label.tagId, value)"
                    >
                      {{ value }} {{ value === 2 ? "强" : "弱" }}
                    </button>
                  </div>
                  <button class="icon-button" type="button" :aria-label="`Remove ${label.tagId}`" @click="removeTag(label.tagId)">
                    ×
                  </button>
                </div>
              </div>
              <div class="exemplar-role-editor">
                <div class="editor-section-heading">
                  <h3>Exemplar roles</h3>
                  <span>Gold-owned · optional</span>
                </div>
                <p class="salience-rubric">
                  Strong and weak roles require the matching label. Counterexamples require an
                  active tag that is absent from this gold.
                </p>
                <form class="exemplar-role-composer" @submit.prevent="addExemplarRole">
                  <label>
                    <span>Kind</span>
                    <select v-model="exemplarKind" @change="syncExemplarTag">
                      <option value="strong">Strong</option>
                      <option value="weak">Weak</option>
                      <option value="counterexample">Counterexample</option>
                    </select>
                  </label>
                  <label>
                    <span>Active tag</span>
                    <select v-model="exemplarTagId" :disabled="!exemplarTagOptions.length">
                      <option v-for="tag in exemplarTagOptions" :key="tag.id" :value="tag.id">
                        {{ tag.id }}
                      </option>
                    </select>
                  </label>
                  <button class="button button--quiet" type="submit" :disabled="!exemplarTagId">
                    Add role
                  </button>
                </form>
                <div v-if="draftExemplarRoles.length" class="exemplar-role-list">
                  <div v-for="role in draftExemplarRoles" :key="role.tagId" class="exemplar-role-row">
                    <strong>{{ role.tagId }}</strong>
                    <select
                      :value="role.kind"
                      :aria-label="`${role.tagId} exemplar kind`"
                      @change="handleExemplarRoleKindChange(role.tagId, $event)"
                    >
                      <option v-for="kind in exemplarKindsForTag(role.tagId)" :key="kind" :value="kind">
                        {{ kind }}
                      </option>
                    </select>
                    <button
                      class="icon-button"
                      type="button"
                      :aria-label="`Remove ${role.tagId} exemplar role`"
                      @click="removeExemplarRole(role.tagId)"
                    >×</button>
                  </div>
                </div>
              </div>
              <div v-if="overlapWarnings.length" class="overlap-warning" role="status">
                <strong>Same-tag overlap</strong>
                <span v-for="warning in overlapWarnings" :key="`${warning.leftAnnotationId}:${warning.rightAnnotationId}:${warning.tagId}`">
                  {{ warning.tagId }} · {{ formatTime(warning.overlap.startMs) }}–{{ formatTime(warning.overlap.endMs) }}
                </span>
                <small>Valid and non-blocking. Review the neighboring gold sections.</small>
              </div>
            </section>

            <section class="editor-section" aria-labelledby="foundation-heading">
              <div class="editor-section-heading">
                <h3 id="foundation-heading">Judgment Foundation</h3>
                <span>r{{ session.foundation.revision }} · {{ directory?.manifest.currentFoundation.sha256.slice(0, 10) }}</span>
              </div>
              <details class="foundation-panel" @toggle="loadFoundationDetails">
                <summary>
                  <strong>{{ session.foundation.tags.filter((tag) => tag.status === "active").length }} active</strong>
                  <span>{{ session.foundation.tags.filter((tag) => tag.status === "retired").length }} retired</span>
                </summary>
                <dl class="foundation-policy-grid">
                  <div><dt>Coordinates</dt><dd>source ms · half-open</dd></div>
                  <div><dt>Dataset</dt><dd>positive-only · overlap allowed</dd></div>
                  <div><dt>Evidence</dt><dd>explicit notes · multi-label</dd></div>
                  <div><dt>Audio</dt><dd>optional context only</dd></div>
                </dl>
                <p class="foundation-detail-status" role="status">
                  {{ foundationDetailsBusy ? "Loading canonical exemplar roles" : foundationDetailsMessage }}
                </p>
                <div class="foundation-tag-details">
                  <details
                    v-for="tag in session.foundation.tags.filter((entry) => entry.status === 'active')"
                    :key="tag.id"
                  >
                    <summary><strong>{{ tag.id }}</strong><span>{{ exemplarViewsForTag(tag.id).length }} roles</span></summary>
                    <p>{{ tag.definition }}</p>
                    <div class="foundation-cue-list">
                      <span>Include</span>
                      <ul><li v-for="cue in tag.inclusionCues" :key="cue">{{ cue }}</li></ul>
                    </div>
                    <div v-if="tag.exclusionCues?.length" class="foundation-cue-list">
                      <span>Exclude</span>
                      <ul><li v-for="cue in tag.exclusionCues" :key="cue">{{ cue }}</li></ul>
                    </div>
                    <small v-if="tag.aliases.length">Aliases · {{ tag.aliases.join(", ") }}</small>
                    <small v-if="tag.salienceClarification">Salience · {{ tag.salienceClarification }}</small>
                    <ol v-if="exemplarViewsForTag(tag.id).length" class="foundation-exemplar-list">
                      <li v-for="entry in exemplarViewsForTag(tag.id)" :key="`${entry.annotationId}:${entry.tagId}`">
                        <strong>{{ entry.kind }}</strong>
                        <span>{{ entry.sourceLabel }}</span>
                        <small>{{ formatTime(entry.range.startMs) }}–{{ formatTime(entry.range.endMs) }}</small>
                      </li>
                    </ol>
                  </details>
                </div>
              </details>
            </section>

            <section class="editor-section">
              <label class="field-stack">
                <span>Judgment note, optional</span>
                <textarea
                  v-model="judgmentNote"
                  rows="3"
                  @focus="beginTextEdit"
                  @input="markDraft()"
                  @blur="finishTextEdit"
                ></textarea>
              </label>
              <div class="commit-actions">
                <button
                  v-if="draftRecoveryVisible"
                  class="button button--quiet discard-button"
                  type="button"
                  :disabled="operationLocked"
                  @click="discardDraft"
                >
                  Discard draft
                </button>
                <button
                  class="button button--primary commit-button"
                  type="button"
                  :disabled="operationLocked || draftCleanupBlocked"
                  @click="commitAnnotation"
                >
                  {{ editingAnnotationId ? "Update gold" : "Commit gold" }}
                  <span class="button-shortcut" aria-hidden="true">↵</span>
                </button>
              </div>
            </section>

            <section class="editor-section existing-section" aria-labelledby="existing-heading">
              <div class="editor-section-heading">
                <h3 id="existing-heading">Existing annotations</h3>
                <span>Gold</span>
              </div>
              <div v-if="annotationList.length" class="annotation-list">
                <article v-for="annotation in annotationList" :key="annotation.id" class="annotation-row">
                  <button class="annotation-seek" type="button" @click="seekAnnotation(annotation)">
                    <strong>{{ formatTime(annotation.range.startMs) }}</strong>
                    <span>{{ formatTime(annotation.range.endMs) }}</span>
                  </button>
                  <div class="annotation-labels">
                    <span v-for="label in annotation.labels" :key="label.tagId">
                      {{ label.tagId }} {{ label.salience }}
                    </span>
                    <span
                      v-for="role in annotation.exemplarRoles"
                      :key="`role-${role.tagId}`"
                      class="annotation-role"
                    >{{ role.tagId }} · {{ role.kind }}</span>
                  </div>
                  <div class="annotation-row-actions">
                    <button type="button" @click="playAnnotation(annotation)">Play</button>
                    <button type="button" @click="editAnnotation(annotation)">Edit</button>
                    <button type="button" @click="deleteAnnotation(annotation)">Delete</button>
                  </div>
                </article>
              </div>
              <p v-else class="empty-copy">No gold sections saved for this chart.</p>
            </section>

            <section class="editor-section" aria-labelledby="review-notes-heading">
              <div class="editor-section-heading">
                <h3 id="review-notes-heading">Review notes</h3>
                <span>{{ openReviewNoteCount }} open</span>
              </div>
              <form class="review-note-form" @submit.prevent="addReviewNote">
                <label class="field-stack">
                  <span>Expert observation · excluded from releases</span>
                  <textarea
                    v-model="reviewNoteText"
                    rows="3"
                    required
                    @input="markReviewNoteDraft"
                  ></textarea>
                </label>
                <label class="review-note-selection">
                  <input
                    v-model="reviewNoteIncludeSelection"
                    type="checkbox"
                    @change="markReviewNoteDraft"
                  />
                  <span>Attach current valid range and selected notes</span>
                </label>
                <button class="button button--quiet" type="submit">Add review note</button>
              </form>
              <div v-if="reviewNotes.length" class="review-note-list">
                <article v-for="note in reviewNotes" :key="note.id" class="review-note-row">
                  <div>
                    <strong>{{ note.state }}</strong>
                    <span v-if="note.range">{{ formatTime(note.range.startMs) }}–{{ formatTime(note.range.endMs) }}</span>
                  </div>
                  <p>{{ note.text }}</p>
                  <div class="review-note-actions">
                    <button v-if="note.range" type="button" @click="seekReviewNote(note.id)">Seek</button>
                    <button v-if="note.state === 'open'" type="button" @click="resolveReviewNote(note.id)">Resolve</button>
                  </div>
                </article>
              </div>
              <p v-if="qualityMessage" class="quality-message" role="status">{{ qualityMessage }}</p>
            </section>

            <section class="editor-section completion-section" aria-labelledby="completion-heading">
              <div class="editor-section-heading">
                <h3 id="completion-heading">Chart review</h3>
                <span>{{ session.document.reviewState }}</span>
              </div>
              <p class="empty-copy">
                Completion requires no draft, no open review note, and no pending silver prediction.
              </p>
              <div class="completion-facts">
                <span :class="{ 'is-clear': !hasUncommittedDraft }">Draft · {{ hasUncommittedDraft ? "open" : "clear" }}</span>
                <span :class="{ 'is-clear': !openReviewNoteCount }">Notes · {{ openReviewNoteCount }}</span>
                <span :class="{ 'is-clear': !pendingPredictionCount }">
                  Silver · {{ pendingPredictionCount }}
                </span>
              </div>
              <button
                class="button button--primary completion-button"
                type="button"
                :disabled="session.document.reviewState === 'complete'"
                @click="markChartComplete"
              >{{ session.document.reviewState === "complete" ? "Chart complete" : "Mark chart complete" }}</button>
            </section>

            <section class="editor-section release-section" aria-labelledby="release-heading">
              <div class="editor-section-heading">
                <h3 id="release-heading">Gold release</h3>
                <span>Canonical complete charts only</span>
              </div>
              <button class="button button--quiet release-preview-button" type="button" @click="previewGoldRelease">
                Build release preview
              </button>
              <p v-if="releaseMessage" class="quality-message" role="status">{{ releaseMessage }}</p>
              <div v-if="releasePreview" class="release-preview">
                <dl>
                  <div><dt>Documents</dt><dd>{{ releasePreview.manifest.documentCount }}</dd></div>
                  <div><dt>Sections</dt><dd>{{ releasePreview.manifest.annotationCount }}</dd></div>
                  <div><dt>Salience 2 / 1</dt><dd>{{ releasePreview.manifest.salienceCounts["2"] }} / {{ releasePreview.manifest.salienceCounts["1"] }}</dd></div>
                  <div><dt>Median / p90</dt><dd>{{ formatMs(releasePreview.manifest.durationDistribution.medianMs) }} / {{ formatMs(releasePreview.manifest.durationDistribution.p90Ms) }} ms</dd></div>
                  <div><dt>Foundations</dt><dd>{{ releasePreview.manifest.foundationDigests.length }}</dd></div>
                </dl>
                <div v-if="releaseTagCounts.length" class="release-tags">
                  <span v-for="[tagId, count] in releaseTagCounts" :key="tagId">{{ tagId }} · {{ count }}</span>
                </div>
                <button
                  class="button button--primary"
                  type="button"
                  @click="confirmGoldRelease"
                >
                  Confirm and write export
                </button>
              </div>
            </section>
          </fieldset>
          <div v-else-if="readonlyTask" class="rail-empty readonly-rail-copy">
            This future-version annotation is inspectable only. Choose another chart to continue
            gold editing.
          </div>
          <div v-else class="rail-empty">Select a chart to begin.</div>
        </aside>
      </div>
    </template>
  </main>
</template>
