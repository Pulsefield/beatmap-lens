<script setup lang="ts">
import type { ManiaNote } from "beatmap-lens";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
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
  visualSpeedPresets,
} from "./annotation/buffered-scene";
import {
  type CatalogSource,
  parseCatalogManifest,
} from "./annotation/catalog";
import type {
  AnnotationDocumentV1,
  AnnotationLabelV1,
  FoundationRefV1,
  FoundationTagV1,
  GoldAnnotationV1,
  JudgmentFoundationV1,
  TimeRangeV1,
} from "./annotation/contracts";
import {
  createDatasetDirectory,
  type DatasetDirectory,
  type FileSystemDatasetDirectory,
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
  activateFoundationTagV1,
  bootstrapFoundationV1,
} from "./annotation/foundation";
import {
  changeNoteSelectionRange,
  createNoteSelection,
  toggleSelectedNote,
} from "./annotation/note-selection";
import { ManiaNoteTimeIndex } from "./annotation/note-time-index";
import { createOverviewDensityPath } from "./annotation/overview-density";
import {
  type PlaybackClockState,
  SyntheticPlaybackClock,
} from "./annotation/playback-clock";
import { rangeCandidates } from "./annotation/range";
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
import { assertAnnotationWorkflowV1 } from "./annotation/validation";
import WorkspaceModeSwitch from "./WorkspaceModeSwitch.vue";
import type { WorkspaceMode } from "./workspace-mode";

type MobilePanel = "source" | "preview" | "details";
type SaveState = "idle" | "draft" | "saving" | "saved" | "conflict" | "error";
type TimelineDragKind = "create" | "move" | `resize-${TimelineRangeEdge}`;

interface EditorUndoState {
  readonly draftStart: string;
  readonly draftEnd: string;
  readonly selectedNoteIds: readonly string[];
  readonly manualExclusions: readonly string[];
  readonly labels: readonly AnnotationLabelV1[];
  readonly judgmentNote: string;
  readonly editingAnnotationId?: string;
}

interface TimelineDragState {
  readonly pointerId: number;
  readonly kind: TimelineDragKind;
  readonly anchorMs: number;
  readonly startClientX: number;
  readonly range?: TimeRangeV1;
  moved: boolean;
  undoCaptured: boolean;
}

interface ViewportDragState {
  readonly pointerId: number;
  readonly startClientY: number;
  readonly startTimeMs: number;
  moved: boolean;
}

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
const setupError = ref("");
const setupBusy = ref(false);
const setupProgress = ref("");
const taskError = ref("");
const taskLoading = ref(false);
const activeMobilePanel = ref<MobilePanel>("preview");
const saveState = ref<SaveState>("idle");
const saveMessage = ref("Local draft only");
const draftStart = ref("0");
const draftEnd = ref("1000");
const rangeError = ref("");
const selectedNoteIds = ref<ReadonlySet<string>>(new Set());
const manualExclusions = ref<ReadonlySet<string>>(new Set());
const draftLabels = ref<readonly AnnotationLabelV1[]>([]);
const judgmentNote = ref("");
const tagQuery = ref("");
const editingAnnotationId = ref<string>();
const activationTag = ref<FoundationTagV1>();
const activationDefinition = ref("");
const activationCue = ref("");
const activationError = ref("");
const activationBusy = ref(false);
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
const playbackState = ref<PlaybackClockState>({
  currentTimeMs: 0,
  playing: false,
  looping: false,
});
const focusedTagId = ref<string>();
const editorUndoStack = ref<readonly EditorUndoState[]>([]);
const draftBase = ref<DraftBaseVersion | null>(null);
const setupRestored = ref(false);
const editorDirty = ref(false);
let draftTimer: number | undefined;
let viewportController: BufferedSceneController | undefined;
let noteTimeIndex: ManiaNoteTimeIndex | undefined;
let playbackClock: SyntheticPlaybackClock | undefined;
let unsubscribePlayback: (() => void) | undefined;
let viewportResizeObserver: ResizeObserver | undefined;
let timelineDrag: TimelineDragState | undefined;
let viewportDrag: ViewportDragState | undefined;
let pendingTextUndo: EditorUndoState | undefined;
let taskOpenGeneration = 0;
const frameDurations: number[] = [];

const activeTask = computed(() =>
  queue.value.find((task) => task.id === activeTaskId.value),
);
const progress = computed(() => queueProgress(queue.value));
const parsedRange = computed(() => readDraftRange(false));
const candidateNotes = computed(() => {
  if (!session.value || !parsedRange.value) return [];
  return rangeCandidates(session.value.chart, parsedRange.value);
});
const candidateNoteIds = computed(() => new Set(candidateNotes.value.map((note) => note.id)));
const selectedCount = computed(() => selectedNoteIds.value.size);
const activeTags = computed(() => filterTags("active"));
const candidateTags = computed(() => filterTags("candidate"));
const suggestedTags = computed(() => {
  if (!session.value) return [];
  const suggestions = new Set(session.value.document.seedContext.suggestedTags);
  return session.value.foundation.tags.filter((tag) => suggestions.has(tag.id));
});
const annotationList = computed(
  () => session.value?.document.annotations ?? [],
);
const operationLocked = computed(
  () => saveState.value === "saving" || activationBusy.value || taskLoading.value,
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
  if (saveState.value === "saved") return "ready";
  if (saveState.value === "error" || saveState.value === "conflict") return "error";
  if (saveState.value === "draft") return "warn";
  return "idle";
});

onMounted(async () => {
  window.addEventListener("keydown", handleWorkspaceKeydown);
  viewportResizeObserver = new ResizeObserver(() => refreshInteractiveGeometry());
  if (!fileSystemSupported) return;
  try {
    const preferences = await sessions.getPreferences();
    if (preferences) {
      annotatorId.value = preferences.annotatorId;
      visualSpeed.value = preferences.visualSpeed;
      visualSpeedDraft.value = String(preferences.visualSpeed);
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
  if (draftTimer !== undefined) window.clearTimeout(draftTimer);
  if (editorDirty.value) void persistDraftNow();
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  disposeInteractiveSession();
  viewportResizeObserver?.disconnect();
});

watch(
  () => session.value?.source.sha256,
  async () => {
    await nextTick();
    initializeInteractiveSession();
  },
  { flush: "post" },
);

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
      musicEnabled: false,
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
    if (firstTask) await openTask(firstTask);
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
  if (
    task.status === "missing-source" ||
    saveState.value === "saving" ||
    activationBusy.value ||
    taskLoading.value
  ) {
    return;
  }
  const generation = ++taskOpenGeneration;
  taskLoading.value = true;
  taskError.value = "";
  pauseForEdit();
  try {
    await flushDraft();
    if (generation !== taskOpenGeneration) return;
    if (task.status === "readonly-future") {
      session.value = undefined;
      readonlyTask.value = task;
      activeTaskId.value = task.id;
      saveState.value = "idle";
      saveMessage.value = `Annotation v${task.future?.version ?? "?"} · read-only`;
      return;
    }
    readonlyTask.value = undefined;
    const next = await loadBeatmapSession(
      task.task,
      catalog.value,
      corpusHandle.value,
      directory.value,
      sessions,
    );
    if (generation !== taskOpenGeneration) return;
    session.value = next;
    activeTaskId.value = task.id;
    restoreEditor(next);
    await nextTick();
  } catch (error) {
    taskError.value = errorMessage(error);
    queue.value = updateQueueItemStatus(
      queue.value,
      task.id,
      "save-error",
      taskError.value,
    );
  } finally {
    if (generation === taskOpenGeneration) taskLoading.value = false;
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
  draftLabels.value = draft?.labels ?? [];
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
  saveState.value = draft ? "draft" : next.base ? "saved" : "idle";
  saveMessage.value = draft
    ? "Draft restored"
    : next.base
      ? `Revision ${next.base.revision}`
      : "Unseen chart";
  editorDirty.value = Boolean(draft);
  editorUndoStack.value = readUndoState(draft?.undoState);
}

function initializeInteractiveSession(): void {
  disposeInteractiveSession();
  const current = session.value;
  const svg = viewportSvg.value;
  if (!current || !svg) return;

  noteTimeIndex = new ManiaNoteTimeIndex(current.chart.notes);
  playbackClock = new SyntheticPlaybackClock();
  const initialTime = Math.min(Math.max(0, playheadMs.value), current.chartEndMs);
  unsubscribePlayback = playbackClock.subscribe((state) => {
    const active = session.value;
    if (!active || active.source.sha256 !== current.source.sha256) return;
    if (state.currentTimeMs > active.chartEndMs) {
      playbackClock?.pause();
      playbackClock?.seek(active.chartEndMs);
      return;
    }

    const startedAt = performance.now();
    playbackState.value = state;
    playheadMs.value = state.currentTimeMs;
    updateViewportFrame(state.currentTimeMs);
    recordFrameDuration(performance.now() - startedAt);
  });
  playbackClock.seek(initialTime);
  viewportResizeObserver?.observe(svg);
  if (overviewSvg.value) viewportResizeObserver?.observe(overviewSvg.value);
  refreshInteractiveGeometry();
}

function disposeInteractiveSession(): void {
  viewportResizeObserver?.disconnect();
  unsubscribePlayback?.();
  unsubscribePlayback = undefined;
  playbackClock?.dispose();
  playbackClock = undefined;
  viewportController = undefined;
  noteTimeIndex = undefined;
  viewportFrame.value = undefined;
  viewportInstrumentation.value = undefined;
  playbackState.value = { currentTimeMs: playheadMs.value, playing: false, looping: false };
  timelineDrag = undefined;
  viewportDrag = undefined;
  pendingTextUndo = undefined;
  frameDurations.length = 0;
  frameP95Ms.value = 0;
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

function recordFrameDuration(durationMs: number): void {
  frameDurations.push(durationMs);
  if (frameDurations.length > 120) frameDurations.shift();
  if (frameDurations.length % 12 !== 0) return;
  const sorted = [...frameDurations].sort((left, right) => left - right);
  frameP95Ms.value = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

async function togglePlayback(): Promise<void> {
  if (!playbackClock || !session.value || operationLocked.value) return;
  if (playbackClock.playing) {
    playbackClock.pause();
    return;
  }
  if (playbackClock.currentTimeMs >= session.value.chartEndMs) playbackClock.seek(0);
  await playbackClock.play();
}

async function playSelectionOnce(): Promise<void> {
  const range = parsedRange.value;
  if (!playbackClock || !range || operationLocked.value) return;
  await playbackClock.playSelection(range);
}

async function toggleSelectionLoop(): Promise<void> {
  const range = parsedRange.value;
  if (!playbackClock || !range || operationLocked.value) return;
  if (playbackState.value.looping) {
    playbackClock.pause();
    return;
  }
  await playbackClock.loopSelection(range);
}

function pauseForEdit(): void {
  if (playbackClock?.playing) playbackClock.pause();
}

function seekPlayhead(timeMs: number): void {
  const endMs = session.value?.chartEndMs ?? 0;
  const time = Math.min(Math.max(0, timeMs), endMs);
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

  visualSpeedError.value = "";
  visualSpeed.value = speed;
  if (viewportController) {
    viewportFrame.value = viewportController.setVisualSpeed(speed, playheadMs.value);
    viewportInstrumentation.value = viewportController.instrumentation();
  }
  const preferences = await sessions.getPreferences();
  await sessions.setPreferences({
    annotatorId: annotatorId.value.trim(),
    musicEnabled: preferences?.musicEnabled ?? false,
    visualSpeed: speed,
  });
  if (editorDirty.value) await persistDraftNow(true);
}

function applyTimelineRange(range: TimeRangeV1, captureUndo = true): void {
  const current = session.value;
  if (!current || operationLocked.value) return;
  pauseForEdit();
  if (captureUndo) recordEditorUndo();

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
  rangeError.value = "";
  markDraft();
}

function beginTimelineDrag(event: PointerEvent, kind: TimelineDragKind): void {
  const svg = overviewSvg.value;
  const current = session.value;
  if (!svg || !current || !noteTimeIndex || operationLocked.value) return;
  const range = parsedRange.value ?? undefined;
  if (kind !== "create" && !range) return;

  event.preventDefault();
  pauseForEdit();
  svg.setPointerCapture(event.pointerId);
  timelineDrag = {
    pointerId: event.pointerId,
    kind,
    anchorMs: overviewTimeFromPointer(event),
    startClientX: event.clientX,
    ...(range ? { range } : {}),
    moved: false,
    undoCaptured: false,
  };
}

function moveTimelineDrag(event: PointerEvent): void {
  const drag = timelineDrag;
  const current = session.value;
  const index = noteTimeIndex;
  if (!drag || drag.pointerId !== event.pointerId || !current || !index) return;
  if (Math.abs(event.clientX - drag.startClientX) >= 2) drag.moved = true;
  if (!drag.moved) return;

  const timeMs = overviewTimeFromPointer(event);
  const options = {
    chartEndMs: current.chartEndMs,
    freePlacement: event.altKey,
  };
  const range =
    drag.kind === "create"
      ? createTimelineRange(drag.anchorMs, timeMs, index, options)
      : drag.kind === "move" && drag.range
        ? moveTimelineRange(drag.range, timeMs - drag.anchorMs, index, options)
        : drag.range
          ? resizeTimelineRange(
              drag.range,
              drag.kind === "resize-start" ? "start" : "end",
              timeMs,
              index,
              options,
            )
          : undefined;
  if (!range) return;
  if (!drag.undoCaptured) {
    recordEditorUndo();
    drag.undoCaptured = true;
  }
  applyTimelineRange(range, false);
}

function endTimelineDrag(event: PointerEvent): void {
  const drag = timelineDrag;
  const svg = overviewSvg.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved) seekPlayhead(overviewTimeFromPointer(event));
  if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  timelineDrag = undefined;
}

function beginViewportScrub(event: PointerEvent): void {
  const svg = viewportSvg.value;
  if (!svg || !session.value || operationLocked.value) return;
  event.preventDefault();
  pauseForEdit();
  svg.setPointerCapture(event.pointerId);
  viewportDrag = {
    pointerId: event.pointerId,
    startClientY: event.clientY,
    startTimeMs: playheadMs.value,
    moved: false,
  };
}

function moveViewportScrub(event: PointerEvent): void {
  const drag = viewportDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const deltaY = drag.startClientY - event.clientY;
  if (Math.abs(deltaY) >= 2) drag.moved = true;
  if (!drag.moved) return;
  seekPlayhead(drag.startTimeMs + (deltaY / visualSpeed.value) * 1_000);
}

function endViewportScrub(event: PointerEvent): void {
  const drag = viewportDrag;
  const svg = viewportSvg.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved) {
    const rect = svg?.getBoundingClientRect();
    if (rect) {
      const y = ((event.clientY - rect.top) / rect.height) * viewportSize.value.height;
      const judgmentY = viewportSize.value.height * judgmentLineRatio;
      seekPlayhead(playheadMs.value + ((judgmentY - y) / visualSpeed.value) * 1_000);
    }
  }
  if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  viewportDrag = undefined;
  if (editorDirty.value) void persistDraftNow(true);
}

async function handleWorkspaceKeydown(event: KeyboardEvent): Promise<void> {
  if (
    !session.value ||
    operationLocked.value ||
    event.defaultPrevented ||
    isTypingTarget(event.target)
  ) {
    return;
  }
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
    judgmentNote: judgmentNote.value,
    ...(editingAnnotationId.value ? { editingAnnotationId: editingAnnotationId.value } : {}),
  };
}

function undoEditor(): void {
  const state = editorUndoStack.value.at(-1);
  if (!state) return;
  pauseForEdit();
  editorUndoStack.value = editorUndoStack.value.slice(0, -1);
  draftStart.value = state.draftStart;
  draftEnd.value = state.draftEnd;
  selectedNoteIds.value = new Set(state.selectedNoteIds);
  manualExclusions.value = new Set(state.manualExclusions);
  draftLabels.value = state.labels;
  judgmentNote.value = state.judgmentNote;
  editingAnnotationId.value = state.editingAnnotationId;
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
  const rect = overviewSvg.value?.getBoundingClientRect();
  const endMs = session.value?.chartEndMs ?? 0;
  if (!rect || rect.width === 0) return 0;
  return Math.min(Math.max(0, ((event.clientX - rect.left) / rect.width) * endMs), endMs);
}

function applyManualRange(captureUndo = true): void {
  if (operationLocked.value) return;
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
  if (!session.value || operationLocked.value) return;
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
  if (operationLocked.value) return;
  if (tag.status !== "active") return;
  if (draftLabels.value.some((label) => label.tagId === tag.id)) return;
  pauseForEdit();
  recordEditorUndo();
  draftLabels.value = [...draftLabels.value, { tagId: tag.id, salience: 2 }];
  focusedTagId.value = tag.id;
  tagQuery.value = "";
  markDraft();
}

function beginTagActivation(tag: FoundationTagV1): void {
  if (operationLocked.value) return;
  if (tag.status !== "candidate") return;
  pauseForEdit();
  activationTag.value = tag;
  activationDefinition.value = tag.definition;
  activationCue.value = tag.inclusionCues[0] ?? "";
  activationError.value = "";
}

async function activateTag(): Promise<void> {
  if (
    !session.value ||
    !directory.value ||
    !activationTag.value ||
    operationLocked.value
  ) {
    return;
  }
  activationError.value = "";
  activationBusy.value = true;
  const activatingSession = session.value;
  const activatingTag = activationTag.value;
  try {
    const nextFoundation = await activateFoundationTagV1(
      activatingSession.foundation,
      {
        tagId: activatingTag.id,
        displayName: activatingTag.displayName,
        definition: activationDefinition.value,
        inclusionCues: [activationCue.value],
      },
      {
        creatorId: annotatorId.value.trim(),
        createdAt: new Date().toISOString(),
      },
    );
    await directory.value.setCurrentFoundation(nextFoundation);
    session.value = { ...activatingSession, foundation: nextFoundation };
    const activated = nextFoundation.tags.find(
      (tag) => tag.id === activatingTag.id,
    );
    activationBusy.value = false;
    if (activated) addTag(activated);
    activationTag.value = undefined;
    activationDefinition.value = "";
    activationCue.value = "";
    saveState.value = "draft";
    saveMessage.value = `Foundation r${nextFoundation.revision} verified · annotation draft pending`;
  } catch (error) {
    activationError.value = errorMessage(error);
  } finally {
    activationBusy.value = false;
  }
}

function removeTag(tagId: string): void {
  if (operationLocked.value) return;
  pauseForEdit();
  recordEditorUndo();
  draftLabels.value = draftLabels.value.filter((label) => label.tagId !== tagId);
  if (focusedTagId.value === tagId) focusedTagId.value = draftLabels.value.at(-1)?.tagId;
  markDraft();
}

function setSalience(tagId: string, salience: 1 | 2): void {
  if (operationLocked.value) return;
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
  if (!session.value || !directory.value || operationLocked.value) return;
  const range = readDraftRange(true);
  if (!range) return;
  if (selectedNoteIds.value.size === 0) {
    return setRangeError("Select at least one intersecting note.");
  }
  if (draftLabels.value.length === 0) {
    return setRangeError("Add at least one active tag.");
  }
  pauseForEdit();

  const existing = session.value.document.annotations.find(
    (annotation) => annotation.id === editingAnnotationId.value,
  );
  const gold = createGoldAnnotation(
    session.value,
    {
      ...(existing ? { existing } : {}),
      range,
      noteIds: [...selectedNoteIds.value],
      labels: draftLabels.value,
      judgmentNote: judgmentNote.value,
      annotatorId: annotatorId.value.trim(),
    },
    directory.value.manifest.currentFoundation,
  );
  const annotations = existing
    ? session.value.document.annotations.map((annotation) =>
        annotation.id === existing.id ? gold : annotation,
      )
    : [...session.value.document.annotations, gold];
  const saved = await persistDocument({
    ...session.value.document,
    annotations,
    reviewState: "in-progress",
  });
  if (!saved) return;

  seekPlayhead(range.endMs);
  clearEditor(range.endMs);
}

function editAnnotation(annotation: GoldAnnotationV1): void {
  if (!session.value || operationLocked.value) return;
  pauseForEdit();
  recordEditorUndo();
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
  judgmentNote.value = annotation.judgmentNote ?? "";
  playheadMs.value = annotation.range.startMs;
  seekPlayhead(annotation.range.startMs);
  rangeError.value = "";
  markDraft();
}

function seekAnnotation(annotation: GoldAnnotationV1): void {
  seekPlayhead(annotation.range.startMs);
}

async function playAnnotation(annotation: GoldAnnotationV1): Promise<void> {
  if (!playbackClock || operationLocked.value) return;
  await playbackClock.playSelection(annotation.range);
}

async function deleteAnnotation(annotation: GoldAnnotationV1): Promise<void> {
  if (!session.value || operationLocked.value) return;
  pauseForEdit();
  const preserveEditor = editorDirty.value && editingAnnotationId.value !== annotation.id;
  const saved = await persistDocument(
    {
      ...session.value.document,
      annotations: session.value.document.annotations.filter(
        (candidate) => candidate.id !== annotation.id,
      ),
      reviewState: "in-progress",
    },
    { preserveEditor },
  );
  if (saved && editingAnnotationId.value === annotation.id) clearEditor(playheadMs.value);
}

async function persistDocument(
  document: AnnotationDocumentV1,
  options: { preserveEditor?: boolean } = {},
): Promise<boolean> {
  if (
    !session.value ||
    !directory.value ||
    !activeTaskId.value ||
    saveState.value === "saving"
  ) {
    return false;
  }
  const savingSession = session.value;
  const savingDirectory = directory.value;
  const savingTaskId = activeTaskId.value;
  const savingDatasetId = savingDirectory.manifest.datasetId;
  const savingSourceSha256 = savingSession.source.sha256;
  saveState.value = "saving";
  saveMessage.value = "Writing canonical sidecar";
  try {
    if (draftTimer !== undefined) {
      window.clearTimeout(draftTimer);
      draftTimer = undefined;
    }
    if (editorDirty.value) await persistDraftNow();
    const foundations = await loadReferencedFoundations(document, savingDirectory);
    await assertAnnotationWorkflowV1(document, {
      sourceBytes: savingSession.sourceBytes,
      chart: savingSession.chart,
      foundations,
    });
    const result = await savingDirectory.saveAnnotation(document, draftBase.value, {
      sourceBytes: savingSession.sourceBytes,
      chart: savingSession.chart,
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
    saveState.value = "saved";
    saveMessage.value = `Revision ${result.version.revision} verified`;
    queue.value = updateQueueItemStatus(
      queue.value,
      savingTaskId,
      result.document.reviewState,
    );
    if (options.preserveEditor && editorDirty.value) {
      await persistDraftNow(true);
      queue.value = updateQueueItemStatus(queue.value, savingTaskId, "draft");
      saveState.value = "draft";
      saveMessage.value = "Draft journal saved after verified delete";
    } else {
      editorDirty.value = false;
      await sessions.deleteDraft(
        savingDatasetId,
        savingSourceSha256,
      );
    }
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

function markDraft(): void {
  if (
    !session.value ||
    !directory.value ||
    !activeTaskId.value ||
    operationLocked.value
  ) {
    return;
  }
  saveState.value = "draft";
  editorDirty.value = true;
  saveMessage.value = "Draft journal pending";
  queue.value = updateQueueItemStatus(queue.value, activeTaskId.value, "draft");
  if (draftTimer !== undefined) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    draftTimer = undefined;
    void persistDraftNow();
  }, 160);
}

async function persistDraftNow(force = false): Promise<void> {
  if (!session.value || !directory.value || (!editorDirty.value && !force)) return;
  const draft = buildDraft(session.value, directory.value.manifest.datasetId);
  await sessions.putDraft(draft);
  if (saveState.value === "draft") saveMessage.value = "Draft journal saved";
}

async function flushDraft(): Promise<void> {
  if (draftTimer !== undefined) {
    window.clearTimeout(draftTimer);
    draftTimer = undefined;
  }
  if (editorDirty.value) await persistDraftNow(true);
}

function buildDraft(current: BeatmapSession, datasetId: string): AnnotationDraft {
  return {
    base: draftBase.value,
    datasetId,
    editorText: judgmentNote.value,
    ...(editingAnnotationId.value
      ? { editingAnnotationId: editingAnnotationId.value }
      : {}),
    labels: draftLabels.value,
    noteRefs: [...selectedNoteIds.value].flatMap((id) => {
      const ref = current.noteRefs.get(id);
      return ref ? [ref] : [];
    }),
    playheadMs: playheadMs.value,
    range: readDraftRange(false),
    rangeEditor: { start: draftStart.value, end: draftEnd.value },
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
  judgmentNote.value = "";
  manualExclusions.value = new Set();
  focusedTagId.value = undefined;
  editorUndoStack.value = [];
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

async function loadReferencedFoundations(
  document: AnnotationDocumentV1,
  dataset: DatasetDirectory,
): Promise<readonly { foundation: JudgmentFoundationV1; sha256: string }[]> {
  const references: FoundationRefV1[] = [
    dataset.manifest.currentFoundation,
    ...document.annotations.map((annotation) => annotation.foundation),
    ...document.predictions.map((prediction) => prediction.foundation),
    ...document.reviewNotes.flatMap((note) =>
      note.resultingFoundation ? [note.resultingFoundation] : [],
    ),
  ];
  const unique = [...new Map(references.map((reference) => [reference.sha256, reference])).values()];
  return Promise.all(
    unique.map(async (reference) => ({
      foundation: await dataset.readFoundation(reference),
      sha256: reference.sha256,
    })),
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
        @update:model-value="emit('change-mode', $event)"
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
              :disabled="task.status === 'missing-source' || taskLoading || saveState === 'saving' || activationBusy"
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
          </div>
          <div v-else-if="session" class="interactive-stage-shell">
            <div class="falling-note-shell">
              <svg
                ref="viewportSvg"
                class="falling-note-viewport"
                :class="{ 'is-locked': operationLocked }"
                :viewBox="`0 0 ${viewportSize.width} ${viewportSize.height}`"
                role="img"
                :aria-label="`${session.source.keyCount}K falling-note evidence. Drag vertically to scrub.`"
                @pointerdown="beginViewportScrub"
                @pointermove="moveViewportScrub"
                @pointerup="endViewportScrub"
                @pointercancel="endViewportScrub"
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
                <span>P95 {{ formatMetric(frameP95Ms) }} ms</span>
              </div>
              <div class="viewport-legend" aria-hidden="true">
                <span><i class="legend-mark legend-mark--selected"></i>Selected</span>
                <span><i class="legend-mark legend-mark--saved"></i>Saved</span>
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
            :disabled="operationLocked"
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
                    @input="markDraft"
                    @blur="finishRangeEdit"
                  />
                </label>
                <label>
                  <span>End ms</span>
                  <input
                    v-model="draftEnd"
                    inputmode="decimal"
                    @focus="beginTextEdit"
                    @input="markDraft"
                    @blur="finishRangeEdit"
                  />
                </label>
              </div>
              <p v-if="rangeError" class="field-error" role="alert">{{ rangeError }}</p>
            </section>

            <section class="editor-section" aria-labelledby="notes-heading">
              <div class="editor-section-heading">
                <h3 id="notes-heading">Note evidence</h3>
                <span>{{ selectedCount }} selected</span>
              </div>
              <div class="candidate-note-list">
                <label v-for="note in candidateNotes" :key="note.id" class="candidate-note-row">
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
                placeholder="Find an active or candidate tag"
              />
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
                This Foundation has no matching active tags. Candidate activation is required before
                a tag can become gold.
              </p>

              <ul v-if="candidateTags.length" class="tag-option-list tag-option-list--candidate" aria-label="Candidate Foundation tags">
                <li v-for="tag in candidateTags" :key="tag.id">
                  <button class="tag-option" type="button" @click="beginTagActivation(tag)">
                    <span class="status-dot" aria-hidden="true"></span>
                    <strong>{{ tag.displayName }}</strong>
                    <small>Activate</small>
                  </button>
                </li>
              </ul>

              <div v-if="suggestedTags.length" class="catalog-suggestion-group">
                <span>Catalog suggestions</span>
                <div class="suggestion-list">
                  <button
                    v-for="tag in suggestedTags"
                    :key="tag.id"
                    class="tag-chip tag-chip--button"
                    type="button"
                    :disabled="tag.status === 'retired'"
                    :title="tag.status === 'active' ? 'Add active tag' : 'Activate candidate tag'"
                    @click="tag.status === 'active' ? addTag(tag) : beginTagActivation(tag)"
                  >
                    {{ tag.id }} · {{ tag.status }}
                  </button>
                </div>
              </div>

              <form v-if="activationTag" class="activation-form" @submit.prevent="activateTag">
                <div class="activation-form-heading">
                  <span>Activate candidate</span>
                  <strong>{{ activationTag.id }}</strong>
                </div>
                <label class="field-stack">
                  <span>Definition</span>
                  <textarea v-model="activationDefinition" rows="3" required></textarea>
                </label>
                <label class="field-stack">
                  <span>Inclusion cue</span>
                  <textarea v-model="activationCue" rows="2" required></textarea>
                </label>
                <p v-if="activationError" class="field-error" role="alert">{{ activationError }}</p>
                <div class="activation-actions">
                  <button class="button button--quiet" type="button" @click="activationTag = undefined">
                    Cancel
                  </button>
                  <button class="button button--primary" type="submit" :disabled="activationBusy">
                    {{ activationBusy ? "Saving Foundation" : "Activate and add" }}
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
            </section>

            <section class="editor-section">
              <label class="field-stack">
                <span>Judgment note, optional</span>
                <textarea
                  v-model="judgmentNote"
                  rows="3"
                  @focus="beginTextEdit"
                  @input="markDraft"
                  @blur="finishTextEdit"
                ></textarea>
              </label>
              <button
                class="button button--primary commit-button"
                type="button"
                :disabled="saveState === 'saving'"
                @click="commitAnnotation"
              >
                {{ editingAnnotationId ? "Update gold" : "Commit gold" }}
                <span class="button-shortcut" aria-hidden="true">↵</span>
              </button>
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
