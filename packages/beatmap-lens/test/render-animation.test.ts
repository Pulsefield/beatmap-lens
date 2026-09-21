import { describe, expect, it } from "vitest";
import {
  createAnimationScene,
  createRenderAnimation,
  iterateAnimationFrames,
  osuLazerManiaPixelsPerSecond,
  parseBeatmap,
  projectTime,
  renderDefaults,
  serializeSvg,
} from "../src/index.js";

const chart = parseBeatmap(`osu file format v14
[General]
Mode:3
[Difficulty]
CircleSize:4
[HitObjects]
64,192,500,128,0,2500:0:0:0:0:
192,192,1000,1,0,0:0:0:0:
320,192,1200,1,0,0:0:0:0:
448,192,1500,1,0,0:0:0:0:
`).chart;

describe("render animation", () => {
  it("resolves inspectable defaults without allocating frames", () => {
    const animation = createRenderAnimation(chart, { range: { startMs: 1000, endMs: 2000 } });
    expect(animation.chart).toBe(chart);
    expect(animation.resolved).toMatchObject({
      viewport: renderDefaults.animation.viewport,
      fps: 30,
      durationMs: 1000,
      frameCount: 30,
      timeDirection: "bottom-to-top",
      pixelsPerSecond: osuLazerManiaPixelsPerSecond({
        gameplayViewport: renderDefaults.animation.viewport,
        scrollSpeed: renderDefaults.animation.scrollSpeed,
      }),
    });
    expect(animation).not.toHaveProperty("frames");
  });

  it("samples a half-open playback range and shortens the final frame", () => {
    const animation = createRenderAnimation(chart, {
      range: { startMs: 1000, endMs: 1255 },
      fps: 10,
    });
    const frames = [...iterateAnimationFrames(animation)];
    expect(frames.map(({ index, timeMs, durationMs }) => [index, timeMs, durationMs])).toEqual([
      [0, 1000, 100],
      [1, 1100, 100],
      [2, 1200, 55],
    ]);
    expect([...iterateAnimationFrames(animation)]).toEqual(frames);
    expect(createAnimationScene(animation, 1123.5).projection.range.startMs).toBe(1123.5);
    expect(() => createAnimationScene(animation, 1255)).toThrow(RangeError);
  });

  it.each(["bottom-to-top", "top-to-bottom"] as const)(
    "moves notes toward the current-time edge with %s time",
    (timeDirection) => {
      const animation = createRenderAnimation(chart, {
        range: { startMs: 1000, endMs: 1300 },
        viewport: { widthPx: 320, heightPx: 240 },
        pixelsPerSecond: 240,
        timeDirection,
      });
      const first = createAnimationScene(animation, 1000);
      const next = createAnimationScene(animation, 1100);
      expect(first.size).toEqual({ widthPx: 320, heightPx: 240 });
      expect(next.size).toEqual(first.size);
      expect(first.projection.range).toEqual({ startMs: 1000, endMs: 1800 });
      const hitY = timeDirection === "bottom-to-top" ? 216 : 24;
      expect(projectTime(first.projection, 1000)).toBe(hitY);
      expect(projectTime(next.projection, 1100)).toBe(hitY);
      const tap = (scene: typeof first) => scene.notes.find((note) => note.startMs === 1200);
      expect((tap(next)?.y ?? 0) - (tap(first)?.y ?? 0)).toBe(
        timeDirection === "bottom-to-top" ? 24 : -24,
      );
      expect(next.notes.some((note) => note.startMs === 1000)).toBe(false);
      // Playback boundaries do not crop the look-ahead window or active holds.
      expect(next.notes.some((note) => note.startMs === 1500)).toBe(true);
      expect(next.notes[0]).toMatchObject({
        kind: "long",
        continuesBefore: true,
        continuesAfter: true,
        y: 24,
        height: 192,
      });
      expect(serializeSvg(next)).toContain('width="320" height="240"');
    },
  );

  it("retains fractional frame timing without accumulated drift", () => {
    const animation = createRenderAnimation(chart, {
      range: { startMs: 10.25, endMs: 10_020.25 },
      fps: 30_000 / 1001,
    });
    const frames = [...iterateAnimationFrames(animation)];
    expect(frames).toHaveLength(300);
    expect(frames.at(-1)?.timeMs).toBeCloseTo(10.25 + (299 * 1001) / 30, 10);
    expect(frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBeCloseTo(10_010, 10);
  });

  it.each([0, 1000.5, 136_781.333])(
    "does not count an extra end-boundary frame at %sms",
    (startMs) => {
      const endMs = startMs + 1000 / 30;
      const animation = createRenderAnimation(chart, { range: { startMs, endMs }, fps: 30 });
      const frames = [...iterateAnimationFrames(animation)];
      expect(animation.resolved.frameCount).toBe(1);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.durationMs).toBe(endMs - startMs);
    },
  );

  it.each([4, 5, 6, 7, 8, 9, 10])(
    "supports %iK and portrait viewports with explicit pixel speed",
    (keyCount) => {
      const animation = createRenderAnimation(
        { ...chart, keyCount },
        {
          range: { startMs: 1000, endMs: 1001 },
          viewport: { widthPx: 320, heightPx: 480 },
          pixelsPerSecond: 300,
          theme: { metrics: { paddingPx: { top: 10, bottom: 30 }, noteInsetPx: 2 } },
        },
      );
      const frames = [...iterateAnimationFrames(animation)];
      expect(frames).toHaveLength(1);
      expect(frames[0]?.durationMs).toBe(1);
      expect(frames[0]?.scene.lanes).toHaveLength(keyCount);
      expect(frames[0]?.scene.size).toEqual({ widthPx: 320, heightPx: 480 });
      expect(frames[0]?.scene.metrics.paddingPx).toEqual({
        top: 10,
        right: 16,
        bottom: 30,
        left: 16,
      });
    },
  );
});
