import { describe, expect, it } from "vitest";
import {
  createRenderScene,
  type LinearRenderTimeProjection,
  parseOsu,
  projectTime,
  toManiaChart,
  unprojectTime,
} from "../src/index.js";

const directions = ["bottom-to-top", "top-to-bottom"] as const;

function projection(direction: (typeof directions)[number]): LinearRenderTimeProjection {
  return {
    type: "linear",
    range: { startMs: -1250, endMs: 2750 },
    direction,
    pixelsPerSecond: 125,
    contentTopPx: 17.5,
    contentHeightPx: 500,
  };
}

describe("render time projection", () => {
  it.each([
    ["top-to-bottom", [17.5, 267.5, 517.5]],
    ["bottom-to-top", [517.5, 267.5, 17.5]],
  ] as const)("projects endpoints and midpoint %s", (direction, expected) => {
    const current = projection(direction);

    expect([-1250, 750, 2750].map((timeMs) => projectTime(current, timeMs))).toEqual(expected);
  });

  it.each(directions)("round-trips non-zero and negative source times %s", (direction) => {
    const current = projection(direction);

    for (const timeMs of [-1250, -999.75, 0, 750, 1533.33, 2750]) {
      expect(
        Math.abs(unprojectTime(current, projectTime(current, timeMs)) - timeMs),
      ).toBeLessThanOrEqual(1e-9);
    }
  });

  it.each([136_781, 139_056, 279_101])(
    "round-trips real-corpus projection endpoints exactly for a %ims range",
    (endMs) => {
      for (const direction of directions) {
        const current: LinearRenderTimeProjection = {
          type: "linear",
          range: { startMs: 0, endMs },
          direction,
          pixelsPerSecond: 240,
          contentTopPx: 24,
          contentHeightPx: (endMs * 240) / 1_000,
        };
        const contentBottomPx = current.contentTopPx + current.contentHeightPx;

        for (const timeMs of [current.range.startMs, current.range.endMs]) {
          expect(unprojectTime(current, projectTime(current, timeMs))).toBe(timeMs);
        }
        for (const yPx of [current.contentTopPx, contentBottomPx]) {
          expect(projectTime(current, unprojectTime(current, yPx))).toBe(yPx);
        }
      }
    },
  );

  it.each(directions)("rejects non-finite and out-of-domain times %s", (direction) => {
    const current = projection(direction);

    for (const timeMs of [
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      -1250.1,
      2750.1,
    ]) {
      expect(() => projectTime(current, timeMs)).toThrowError(RangeError);
    }
  });

  it.each(directions)("rejects non-finite and out-of-domain Y coordinates %s", (direction) => {
    const current = projection(direction);

    for (const yPx of [
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      17.4,
      517.6,
    ]) {
      expect(() => unprojectTime(current, yPx)).toThrowError(RangeError);
    }
  });

  it("does not impose a minimum height on a short range", () => {
    const chart = toManiaChart(
      parseOsu(`osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
64,192,1000,1,0,0:0:0:0:
`),
    );
    const scene = createRenderScene(chart, {
      range: { startMs: 1000, endMs: 1001 },
      pixelsPerSecond: 240,
    });
    const { projection } = scene;

    expect(projection.contentHeightPx).toBe(0.24);
    expect(scene.lanes[0]?.height).toBe(0.24);
    expect(Math.abs(projectTime(projection, 1001) - projectTime(projection, 1000))).toBeCloseTo(
      0.24,
      12,
    );
  });

  it.each(directions)("clips a crossing long note before projecting it %s", (direction) => {
    const chart = toManiaChart(
      parseOsu(`osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
64,192,500,128,0,2500:0:0:0:0:
`),
    );
    const scene = createRenderScene(chart, {
      range: { startMs: 1000, endMs: 2000 },
      timeDirection: direction,
      pixelsPerSecond: 100,
    });

    expect(scene.notes[0]).toMatchObject({
      startMs: 500,
      endMs: 2500,
      continuesBefore: true,
      continuesAfter: true,
      y: 24,
      height: 100,
    });
  });
});
