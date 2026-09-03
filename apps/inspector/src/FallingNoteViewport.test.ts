// @vitest-environment happy-dom

import type { ManiaChart, ManiaNote } from "beatmap-lens";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive } from "vue";
import { BufferedSceneController, type BufferedSceneFrame } from "./annotation/buffered-scene";
import FallingNoteViewport from "./FallingNoteViewport.vue";

const mountedApps: ReturnType<typeof createApp>[] = [];

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

describe("FallingNoteViewport", () => {
  it.each(["top", "bottom"] as const)(
    "keeps %s-edge clicks and Shift-drags stable across refresh, resize, and speed changes",
    async (edge) => {
      const chart = denseChart(3_000);
      const initialController = controller(chart, 400, 240);
      const initialFrame = initialController.frame(100_000);
      const playheadMs =
        edge === "top"
          ? initialFrame.refreshThreshold.maximumPlayheadMs
          : initialFrame.refreshThreshold.minimumPlayheadMs;
      const state = reactive({
        frame: initialController.frame(playheadMs) as BufferedSceneFrame,
        playheadMs,
        size: { width: 640, height: 400 },
        visualSpeed: 240,
      });
      const seeks: number[] = [];
      const errors: unknown[] = [];
      const container = document.createElement("div");
      document.body.append(container);
      const app = createApp({
        render: () =>
          h(FallingNoteViewport, {
            annotationBands: [],
            candidateNoteIds: new Set<string>(),
            chartArtist: "Corpus",
            chartDifficulty: "Endpoint regression",
            chartEndMs: chart.range.endMs,
            chartTitle: "Mounted viewport",
            frame: state.frame,
            frameP95Ms: 0,
            keyCount: chart.keyCount,
            locked: false,
            playheadMs: state.playheadMs,
            selectedNoteIds: new Set<string>(),
            size: state.size,
            visualSpeed: state.visualSpeed,
            onSeek: (timeMs: number) => seeks.push(timeMs),
          }),
      });
      app.config.errorHandler = (error) => errors.push(error);
      mountedApps.push(app);
      app.mount(container);
      await nextTick();

      const svg = container.querySelector("svg");
      expect(svg).toBeInstanceOf(SVGSVGElement);
      let renderedHeight = 400;
      Object.defineProperty(svg, "getBoundingClientRect", {
        configurable: true,
        value: () => viewportRect(renderedHeight),
      });
      const edgeClientY = () => (edge === "top" ? 100 : 100 + renderedHeight);
      const inwardClientY = () => edgeClientY() + (edge === "top" ? 10 : -10);

      dispatchPointer(svg, "pointerdown", edgeClientY(), false, 1);
      dispatchPointer(svg, "pointerup", edgeClientY(), false, 1);

      const expectedClickTime =
        edge === "top"
          ? state.frame.scene.projection.range.endMs
          : state.frame.scene.projection.range.startMs;
      expect(seeks.at(-1)).toBe(expectedClickTime);

      dispatchPointer(svg, "pointerdown", edgeClientY(), true, 2);
      const dragClientY = inwardClientY();
      dispatchPointer(svg, "pointermove", dragClientY, true, 2);
      const beforeRefresh = seeks.at(-1);

      state.frame = initialController.frame(playheadMs + (edge === "top" ? 1 : -1));
      await nextTick();
      dispatchPointer(svg, "pointermove", dragClientY, true, 2);
      expect(seeks.at(-1)).toBeCloseTo(beforeRefresh ?? 0, 9);

      renderedHeight = 500;
      state.size = { width: 700, height: renderedHeight };
      state.frame = controller(chart, renderedHeight, 240).frame(playheadMs);
      await nextTick();
      dispatchPointer(svg, "pointermove", dragClientY, true, 2);
      expect(seeks.at(-1)).toBeCloseTo(beforeRefresh ?? 0, 9);

      state.visualSpeed = 480;
      state.frame = controller(chart, renderedHeight, state.visualSpeed).frame(playheadMs);
      await nextTick();
      dispatchPointer(svg, "pointermove", dragClientY, true, 2);
      const afterSpeedChange = seeks.at(-1);

      dispatchPointer(svg, "pointerup", dragClientY, true, 2);

      expect(afterSpeedChange).toBeCloseTo(
        playheadMs + (edge === "top" ? -1 : 1) * (10 / state.visualSpeed) * 1_000,
        9,
      );
      expect(seeks.every(Number.isFinite)).toBe(true);
      expect(errors).toEqual([]);
    },
  );
});

function controller(
  chart: ManiaChart,
  viewportHeight: number,
  pixelsPerSecond: number,
): BufferedSceneController {
  return new BufferedSceneController(chart, {
    viewportHeight,
    width: 640,
    pixelsPerSecond,
  });
}

function denseChart(noteCount: number): ManiaChart {
  const notes = Array.from({ length: noteCount }, (_, index): ManiaNote => {
    const startMs = index * 100;
    return {
      id: `note-${index}`,
      kind: "normal",
      sourceKind: "normal",
      column: index % 4,
      startMs,
      endMs: startMs,
      sourceLine: index + 1,
      x: 64,
      hitSound: 0,
    };
  });
  return {
    keyCount: 4,
    metadata: {},
    notes,
    range: { startMs: 0, endMs: (noteCount - 1) * 100 + 1 },
    diagnostics: [],
  };
}

function dispatchPointer(
  target: Element | null,
  type: string,
  clientY: number,
  shiftKey: boolean,
  pointerId: number,
): void {
  target?.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      clientY,
      pointerId,
      shiftKey,
    }),
  );
}

function viewportRect(height: number): DOMRect {
  return {
    bottom: 100 + height,
    height,
    left: 0,
    right: 640,
    top: 100,
    width: 640,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  };
}
