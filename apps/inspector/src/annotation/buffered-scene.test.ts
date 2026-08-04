import type { ManiaChart, ManiaNote } from "beatmap-lens";
import { describe, expect, it } from "vitest";
import { BufferedSceneController } from "./buffered-scene";

describe("BufferedSceneController", () => {
  it("builds only a three-viewport note buffer for a dense 7K chart", () => {
    const controller = new BufferedSceneController(denseChart(10_000), {
      viewportHeight: 240,
      width: 420,
      pixelsPerSecond: 240,
    });

    const frame = controller.frame(5_000);
    const counters = controller.instrumentation();

    expect(frame.bufferRange.endMs - frame.bufferRange.startMs).toBe(3_000);
    expect(frame.scene.keyCount).toBe(7);
    expect(frame.keyedNotes).toHaveLength(counters.lastBufferedNoteCount);
    expect(counters.lastBufferedNoteCount).toBeLessThanOrEqual(31);
    expect(counters.sceneBuildCount).toBe(1);
  });

  it.each([4, 5, 6, 7])("creates keyed lane geometry for %iK charts", (keyCount) => {
    const controller = new BufferedSceneController(denseChart(100, keyCount), {
      viewportHeight: 240,
      width: 420,
    });

    const frame = controller.frame(1_000);

    expect(frame.keyedLanes.map(({ key }) => key)).toEqual(
      Array.from({ length: keyCount }, (_, column) => `lane-${column}`),
    );
  });

  it("reuses keyed geometry until the playhead crosses a refresh threshold", () => {
    const controller = new BufferedSceneController(denseChart(1_000), {
      viewportHeight: 240,
      width: 420,
      pixelsPerSecond: 240,
    });

    const initial = controller.frame(5_000);
    const inside = controller.frame(initial.refreshThreshold.maximumPlayheadMs);
    const crossed = controller.frame(initial.refreshThreshold.maximumPlayheadMs + 1);

    expect(inside.refreshed).toBe(false);
    expect(inside.scene).toBe(initial.scene);
    expect(inside.keyedNotes).toBe(initial.keyedNotes);
    expect(inside.noteGroupTransform).not.toBe(initial.noteGroupTransform);
    expect(crossed.refreshed).toBe(true);
    expect(crossed.scene).not.toBe(initial.scene);
    expect(controller.instrumentation()).toMatchObject({
      sceneBuildCount: 2,
      reusedFrameCount: 1,
    });
  });

  it("places the playhead note on the fixed 82% judgment line", () => {
    const controller = new BufferedSceneController(denseChart(100), {
      viewportHeight: 240,
      width: 420,
    });

    const frame = controller.frame(5_000);
    const playheadNote = frame.scene.notes.find(({ startTime }) => startTime === 5_000);
    const translationY = Number(frame.noteGroupTransform.match(/ ([\d.]+)\)$/)?.[1]);
    const transformedCenter =
      translationY - ((playheadNote?.y ?? 0) + (playheadNote?.height ?? 0) / 2);

    expect(transformedCenter).toBe(196.8);
  });

  it("rebuilds immediately when visual speed changes", () => {
    const controller = new BufferedSceneController(denseChart(1_000), {
      viewportHeight: 240,
      width: 420,
    });

    const initial = controller.frame(2_000);
    const faster = controller.setVisualSpeed(480, 2_000);

    expect(faster.refreshed).toBe(true);
    expect(faster.revision).toBe(initial.revision + 1);
    expect(faster.bufferRange.endMs - faster.bufferRange.startMs).toBe(1_500);
  });
});

function denseChart(noteCount: number, keyCount = 7): ManiaChart {
  return {
    keyCount,
    metadata: {},
    notes: Array.from({ length: noteCount }, (_, index) => note(index, keyCount)),
    diagnostics: [],
  };
}

function note(index: number, keyCount: number): ManiaNote {
  const startTime = index * 100;
  return {
    id: `note-${index}`,
    kind: "normal",
    sourceKind: "normal",
    column: index % keyCount,
    startTime,
    endTime: startTime,
    sourceLine: index + 1,
    x: 64,
    hitSound: 0,
  };
}
