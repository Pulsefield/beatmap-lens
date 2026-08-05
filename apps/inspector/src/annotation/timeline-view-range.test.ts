import { describe, expect, it } from "vitest";
import {
  applyTimelineEdgePan,
  calculateTimelineEdgePan,
  clampTimelineViewRange,
  fitTimelineViewRange,
  minimumTimelineViewDuration,
  normalizeTimelineWheelZoomDelta,
  offsetTimelineViewRange,
  timelineSourceTimeFromClampedY,
  timelineSourceTimeFromY,
  timelineViewDurationMs,
  timelineYFromSourceTime,
  timelineZoomAnchorMs,
  zoomTimelineViewRangeAtTime,
  zoomTimelineViewRangeAtY,
} from "./timeline-view-range";

describe("timeline view range mapping", () => {
  const mapping = { viewRange: { startMs: 0, endMs: 1_000 }, height: 100 };

  it("maps top to later source time and bottom to earlier source time", () => {
    expect(timelineSourceTimeFromY(0, mapping)).toBe(1_000);
    expect(timelineSourceTimeFromY(100, mapping)).toBe(0);
    expect(timelineYFromSourceTime(750, mapping)).toBe(25);
  });

  it("clamps pointer Y before projecting captured pointer coordinates to source time", () => {
    expect(timelineSourceTimeFromClampedY(-20, mapping)).toBe(1_000);
    expect(timelineSourceTimeFromClampedY(140, mapping)).toBe(0);
  });

  it("fits and clamps the temporary timeline lens inside the chart", () => {
    expect(fitTimelineViewRange(4_000)).toEqual({ startMs: 0, endMs: 4_000 });
    expect(minimumTimelineViewDuration(700)).toBe(700);
    expect(clampTimelineViewRange({ startMs: -200, endMs: 400 }, 4_000)).toEqual({
      startMs: 0,
      endMs: 1_000,
    });
    expect(clampTimelineViewRange({ startMs: 3_500, endMs: 5_000 }, 4_000)).toEqual({
      startMs: 2_500,
      endMs: 4_000,
    });
  });

  it("offsets a lens without changing its duration", () => {
    const shifted = offsetTimelineViewRange({ startMs: 1_000, endMs: 2_000 }, 400, 3_000);

    expect(shifted).toEqual({ startMs: 1_400, endMs: 2_400 });
    expect(timelineViewDurationMs(shifted)).toBe(1_000);
  });
});

describe("timeline point-anchored zoom", () => {
  it("keeps the pointer source time under the same pixel away from chart boundaries", () => {
    const viewRange = { startMs: 0, endMs: 4_000 };
    const next = zoomTimelineViewRangeAtY({
      viewRange,
      chartEndMs: 4_000,
      height: 400,
      anchorY: 100,
      zoomDelta: 1,
    });

    expect(next).toEqual({ startMs: 1_500, endMs: 3_500 });
    expect(timelineYFromSourceTime(3_000, { viewRange: next, height: 400 })).toBe(100);
  });

  it("allows the anchor pixel to drift only when chart boundaries clamp the lens", () => {
    expect(
      zoomTimelineViewRangeAtY({
        viewRange: { startMs: 0, endMs: 4_000 },
        chartEndMs: 4_000,
        height: 400,
        anchorY: 0,
        zoomDelta: 1,
      }),
    ).toEqual({ startMs: 2_000, endMs: 4_000 });
    expect(
      zoomTimelineViewRangeAtY({
        viewRange: { startMs: 1_000, endMs: 2_000 },
        chartEndMs: 5_000,
        height: 100,
        anchorY: 50,
        zoomDelta: -5,
      }),
    ).toEqual({ startMs: 0, endMs: 5_000 });
  });

  it("clamps zoom duration to one second unless the chart is shorter", () => {
    expect(
      timelineViewDurationMs(
        zoomTimelineViewRangeAtY({
          viewRange: { startMs: 0, endMs: 5_000 },
          chartEndMs: 5_000,
          height: 500,
          anchorY: 250,
          zoomDelta: 10,
        }),
      ),
    ).toBe(1_000);
    expect(
      timelineViewDurationMs(
        zoomTimelineViewRangeAtY({
          viewRange: { startMs: 0, endMs: 700 },
          chartEndMs: 700,
          height: 500,
          anchorY: 250,
          zoomDelta: 10,
        }),
      ),
    ).toBe(700);
  });

  it("uses visible playhead time or lens center for button and keyboard zoom anchors", () => {
    expect(timelineZoomAnchorMs({ startMs: 1_000, endMs: 3_000 }, 2_000)).toBe(2_000);
    expect(timelineZoomAnchorMs({ startMs: 1_000, endMs: 3_000 }, 4_000)).toBe(2_000);
    expect(
      zoomTimelineViewRangeAtTime({
        viewRange: { startMs: 1_000, endMs: 3_000 },
        chartEndMs: 5_000,
        anchorMs: 2_000,
        zoomDelta: 1,
      }),
    ).toEqual({ startMs: 1_500, endMs: 2_500 });
  });
});

describe("timeline wheel and edge-pan math", () => {
  it("normalizes wheel delta modes and ctrlKey pinch sensitivity", () => {
    expect(normalizeTimelineWheelZoomDelta({ deltaY: 1, deltaMode: 0 })).toBe(-0.002);
    expect(normalizeTimelineWheelZoomDelta({ deltaY: 1, deltaMode: 0, ctrlKey: true })).toBe(-0.02);
    expect(normalizeTimelineWheelZoomDelta({ deltaY: 2, deltaMode: 1, ctrlKey: true })).toBe(-1);
    expect(normalizeTimelineWheelZoomDelta({ deltaY: -1, deltaMode: 2 })).toBe(1);
  });

  it("calculates square-ramped top edge pan toward later time", () => {
    const pan = calculateTimelineEdgePan({
      viewRange: { startMs: 1_000, endMs: 2_000 },
      chartEndMs: 3_000,
      height: 500,
      pointerY: 20,
      elapsedMs: 1_000,
    });

    expect(pan).toEqual({
      direction: "later",
      penetration: 0.5,
      velocityMsPerSecond: 250,
      deltaMs: 250,
    });
    expect(
      applyTimelineEdgePan({
        viewRange: { startMs: 1_000, endMs: 2_000 },
        chartEndMs: 3_000,
        height: 500,
        pointerY: 20,
        elapsedMs: 1_000,
      }),
    ).toEqual({ startMs: 1_250, endMs: 2_250 });
  });

  it("treats offscreen and bottom edge pan as bounded lens movement", () => {
    expect(
      applyTimelineEdgePan({
        viewRange: { startMs: 1_000, endMs: 2_000 },
        chartEndMs: 3_000,
        height: 500,
        pointerY: -10,
        elapsedMs: 1_000,
      }),
    ).toEqual({ startMs: 2_000, endMs: 3_000 });
    expect(
      applyTimelineEdgePan({
        viewRange: { startMs: 1_000, endMs: 2_000 },
        chartEndMs: 3_000,
        height: 500,
        pointerY: 490,
        elapsedMs: 1_000,
      }),
    ).toEqual({ startMs: 437.5, endMs: 1_437.5 });
  });

  it("does not pan when the pointer is outside the edge zones", () => {
    expect(
      calculateTimelineEdgePan({
        viewRange: { startMs: 1_000, endMs: 2_000 },
        chartEndMs: 3_000,
        height: 500,
        pointerY: 250,
        elapsedMs: 1_000,
      }),
    ).toBeUndefined();
  });
});
