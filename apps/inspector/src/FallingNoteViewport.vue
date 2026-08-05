<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  type BufferedSceneFrame,
  type BufferedSceneInstrumentation,
  judgmentLineRatio,
  viewportYToSourceTime,
} from "./annotation/buffered-scene";
import type { GoldAnnotationV1 } from "./annotation/contracts";
import {
  advanceViewportAutoScroll,
  type ViewportClientRect,
  viewportEdgePenetration,
  viewportPointerY,
} from "./annotation/viewport-auto-scroll";

interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

interface ViewportBandGeometry {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

interface AnnotationViewportBand extends ViewportBandGeometry {
  readonly annotation: GoldAnnotationV1;
}

interface RangeStartIntent {
  readonly anchorMs: number;
  readonly freePlacement: boolean;
}

interface RangeFocusIntent {
  readonly focusMs: number;
}

interface ViewportGesture {
  readonly anchorMs: number;
  readonly kind: "scrub" | "select";
  readonly pointerId: number;
  readonly startClientY: number;
  readonly startPlayheadMs: number;
  readonly freePlacement: boolean;
  lastClientY: number;
  lastFrameTimestamp: number | undefined;
  moved: boolean;
  workingPlayheadMs: number;
}

const props = defineProps<{
  annotationBands: readonly AnnotationViewportBand[];
  candidateNoteIds: ReadonlySet<string>;
  chartArtist: string;
  chartDifficulty: string;
  chartEndMs: number;
  chartTitle: string;
  frame?: BufferedSceneFrame;
  frameP95Ms: number;
  instrumentation?: BufferedSceneInstrumentation;
  keyCount: number;
  locked: boolean;
  playheadMs: number;
  selectedNoteIds: ReadonlySet<string>;
  selectionBand?: ViewportBandGeometry;
  size: ViewportSize;
  visualSpeed: number;
}>();

const emit = defineEmits<{
  "annotation-seek": [annotation: GoldAnnotationV1];
  "gesture-active": [active: boolean];
  "note-toggle": [noteId: string];
  "range-cancel": [];
  "range-commit": [intent: RangeFocusIntent];
  "range-preview": [intent: RangeFocusIntent];
  "range-start": [intent: RangeStartIntent];
  resize: [size: ViewportSize];
  seek: [timeMs: number];
}>();

const viewportSvg = ref<SVGSVGElement>();

let resizeObserver: ResizeObserver | undefined;
let activeGesture: ViewportGesture | undefined;
let selectFrame: number | undefined;
let lastEmittedSize: ViewportSize | undefined;

const viewBox = computed(() => `0 0 ${props.size.width} ${props.size.height}`);
const chartIdentity = computed(() =>
  [props.chartTitle, props.chartArtist, props.chartDifficulty].filter(Boolean).join(" · "),
);
const selectedCount = computed(() => props.selectedNoteIds.size);
const candidateCount = computed(() => props.candidateNoteIds.size);
const svgAriaLabel = computed(
  () =>
    `${props.keyCount}K falling-note evidence for ${chartIdentity.value}. Drag to select, Shift-drag to scrub, or hold Alt for free placement.`,
);

onMounted(() => {
  resizeObserver = new ResizeObserver(measureViewport);
  if (viewportSvg.value) resizeObserver.observe(viewportSvg.value);
  window.addEventListener("keydown", handleWindowKeydown);
  void nextTick(measureViewport);
});

onBeforeUnmount(() => {
  cancelActiveGesture();
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleWindowKeydown);
});

watch(
  () => props.locked,
  (locked) => {
    if (locked) cancelActiveGesture();
  },
);

watch(
  () => props.chartEndMs,
  () => cancelActiveGesture(),
);

function measureViewport(): void {
  const svg = viewportSvg.value;
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  const nextSize = {
    width: Math.max(320, Math.round(rect.width || props.size.width)),
    height: Math.max(1, Math.round(rect.height || props.size.height)),
  };
  if (sameSize(nextSize, props.size) || sameSize(nextSize, lastEmittedSize)) return;

  lastEmittedSize = nextSize;
  emit("resize", nextSize);
}

function beginViewportGesture(event: PointerEvent): void {
  const svg = viewportSvg.value;
  if (!svg || props.locked || activeGesture || event.button !== 0) return;

  event.preventDefault();
  svg.setPointerCapture(event.pointerId);

  const startPlayheadMs = props.playheadMs;
  const anchorMs = sourceTimeFromClientY(event.clientY, startPlayheadMs);
  const kind = event.shiftKey ? "scrub" : "select";
  activeGesture = {
    anchorMs,
    kind,
    pointerId: event.pointerId,
    startClientY: event.clientY,
    startPlayheadMs,
    freePlacement: event.altKey,
    lastClientY: event.clientY,
    lastFrameTimestamp: undefined,
    moved: false,
    workingPlayheadMs: startPlayheadMs,
  };

  if (kind === "select") {
    emit("range-start", { anchorMs, freePlacement: event.altKey });
  }
  emit("gesture-active", true);
}

function moveViewportGesture(event: PointerEvent): void {
  const gesture = activeGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  gesture.lastClientY = event.clientY;
  if (Math.abs(gesture.startClientY - event.clientY) >= 2) gesture.moved = true;
  if (!gesture.moved) return;

  if (gesture.kind === "scrub") {
    emitScrubSeek(gesture);
    return;
  }
  requestSelectFrame();
}

function endViewportGesture(event: PointerEvent): void {
  const gesture = activeGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  event.preventDefault();
  gesture.lastClientY = event.clientY;
  if (Math.abs(gesture.startClientY - event.clientY) >= 2) gesture.moved = true;

  if (!gesture.moved) {
    const seekMs = sourceTimeFromClientY(event.clientY, gesture.workingPlayheadMs);
    finishActiveGesture();
    if (gesture.kind === "select") emit("range-cancel");
    emitSeek(seekMs);
    return;
  }

  if (gesture.kind === "scrub") {
    emitScrubSeek(gesture);
    finishActiveGesture();
    return;
  }

  const focusMs = sourceTimeFromClientY(gesture.lastClientY, gesture.workingPlayheadMs);
  finishActiveGesture();
  emit("range-commit", { focusMs });
}

function cancelViewportGesture(event: PointerEvent): void {
  const gesture = activeGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  cancelActiveGesture();
}

function cancelActiveGesture(): void {
  const gesture = activeGesture;
  if (!gesture) return;
  finishActiveGesture();
  if (gesture.kind === "select") emit("range-cancel");
}

function finishActiveGesture(): void {
  const gesture = activeGesture;
  if (!gesture) return;

  activeGesture = undefined;
  cancelSelectFrame();
  releasePointerCapture(gesture.pointerId);
  emit("gesture-active", false);
}

function requestSelectFrame(): void {
  if (selectFrame !== undefined) return;
  selectFrame = requestAnimationFrame(runSelectFrame);
}

function runSelectFrame(timestamp: number): void {
  selectFrame = undefined;

  const gesture = activeGesture;
  if (gesture?.kind !== "select" || !gesture.moved) return;

  const penetration = edgePenetrationFromClientY(gesture.lastClientY);
  if (penetration) {
    const previousTimestamp = gesture.lastFrameTimestamp ?? timestamp - 16.7;
    const elapsedMs = Math.min(Math.max(0, timestamp - previousTimestamp), 64);
    const advance = advanceViewportAutoScroll({
      chartEndMs: props.chartEndMs,
      elapsedMs,
      penetration,
      playheadMs: gesture.workingPlayheadMs,
      viewportDurationMs: (props.size.height / props.visualSpeed) * 1_000,
    });
    gesture.workingPlayheadMs = advance.playheadMs;
    if (advance.deltaMs !== 0) emitSeek(advance.playheadMs);
  }

  gesture.lastFrameTimestamp = timestamp;
  emit("range-preview", {
    focusMs: sourceTimeFromClientY(gesture.lastClientY, gesture.workingPlayheadMs),
  });

  if (penetration && gesture.workingPlayheadMs > 0 && gesture.workingPlayheadMs < props.chartEndMs) {
    requestSelectFrame();
  }
}

function cancelSelectFrame(): void {
  if (selectFrame !== undefined) cancelAnimationFrame(selectFrame);
  selectFrame = undefined;
}

function emitScrubSeek(gesture: ViewportGesture): void {
  const deltaY = gesture.startClientY - gesture.lastClientY;
  emitSeek(gesture.startPlayheadMs + (deltaY / props.visualSpeed) * 1_000);
}

function emitSeek(timeMs: number): void {
  emit("seek", clamp(timeMs, 0, props.chartEndMs));
}

function seekAnnotation(annotation: GoldAnnotationV1): void {
  if (!props.locked) emit("annotation-seek", annotation);
}

function toggleNote(noteId: string): void {
  if (!props.locked) emit("note-toggle", noteId);
}

function sourceTimeFromClientY(clientY: number, playheadMs: number): number {
  return viewportYToSourceTime({
    chartEndMs: props.chartEndMs,
    pixelsPerSecond: props.visualSpeed,
    playheadMs,
    viewportHeight: props.size.height,
    viewportY: viewportYFromClientY(clientY),
  });
}

function viewportYFromClientY(clientY: number): number {
  const rect = viewportRect();
  if (!rect) return props.size.height * judgmentLineRatio;
  return viewportPointerY({
    clientY,
    rect,
    viewportHeight: props.size.height,
  }).viewportY;
}

function edgePenetrationFromClientY(clientY: number) {
  const rect = viewportRect();
  return rect ? viewportEdgePenetration({ clientY, rect }) : undefined;
}

function viewportRect(): ViewportClientRect | undefined {
  const rect = viewportSvg.value?.getBoundingClientRect();
  if (!rect || rect.height === 0) return undefined;
  return { bottom: rect.bottom, height: rect.height, top: rect.top };
}

function releasePointerCapture(pointerId: number): void {
  const svg = viewportSvg.value;
  if (svg?.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") cancelActiveGesture();
}

function sameSize(left: ViewportSize | undefined, right: ViewportSize | undefined): boolean {
  return Boolean(left && right && left.width === right.width && left.height === right.height);
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const milliseconds = Math.floor(value % 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatMetric(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
</script>

<template>
  <div class="falling-note-shell">
    <svg
      ref="viewportSvg"
      class="falling-note-viewport"
      :class="{ 'is-locked': locked }"
      :viewBox="viewBox"
      role="img"
      :aria-label="svgAriaLabel"
      @pointerdown="beginViewportGesture"
      @pointermove="moveViewportGesture"
      @pointerup="endViewportGesture"
      @pointercancel="cancelViewportGesture"
      @lostpointercapture="cancelViewportGesture"
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
      <g v-if="frame" class="viewport-lanes" aria-hidden="true">
        <rect
          v-for="entry in frame.keyedLanes"
          :key="entry.key"
          :x="entry.lane.x"
          y="0"
          :width="entry.lane.width"
          :height="size.height"
          :fill="entry.lane.fill"
          :stroke="entry.lane.stroke"
        />
      </g>
      <g v-if="frame" class="moving-note-group" :transform="frame.noteGroupTransform">
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
          v-for="entry in frame.keyedNotes"
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
          @click.stop="toggleNote(entry.glyph.id)"
        />
      </g>
      <g class="judgment-guide" aria-hidden="true">
        <line
          x1="0"
          :y1="size.height * judgmentLineRatio"
          :x2="size.width"
          :y2="size.height * judgmentLineRatio"
        />
        <text x="12" :y="size.height * judgmentLineRatio - 8">JUDGE · 82%</text>
      </g>
    </svg>
    <div class="viewport-instrumentation" aria-hidden="true">
      <span class="viewport-identity">{{ chartIdentity }}</span>
      <span>{{ formatTime(playheadMs) }}</span>
      <template v-if="frame && instrumentation">
        <span>BUF R{{ frame.revision }}</span>
        <span>{{ frame.refreshed ? "REFRESH" : "REUSE" }}</span>
        <span>
          BUILD {{ instrumentation.sceneBuildCount }} · REUSE
          {{ instrumentation.reusedFrameCount }}
        </span>
        <span>
          N {{ instrumentation.lastRenderedNoteCount }} / MAX
          {{ instrumentation.maximumRenderedNoteCount }}
        </span>
        <span>
          BUILD {{ formatMetric(instrumentation.lastBuildDurationMs) }} /
          {{ formatMetric(instrumentation.maximumBuildDurationMs) }} ms
        </span>
        <span>RAF P95 {{ formatMetric(frameP95Ms) }} ms</span>
      </template>
    </div>
    <div class="viewport-legend" aria-hidden="true">
      <span><i class="legend-mark legend-mark--selected"></i>Selected</span>
      <span><i class="legend-mark legend-mark--saved"></i>Saved</span>
      <span>{{ selectedCount }} / {{ candidateCount }} notes selected</span>
      <span>Drag select · Shift scrub · Alt free</span>
    </div>
  </div>
</template>
