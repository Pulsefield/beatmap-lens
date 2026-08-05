import { describe, expect, it } from "vitest";
import { navigateViewportTime, viewportArrowStepPx, wheelDeltaPixels } from "./viewport-navigation";

describe("viewport navigation", () => {
  it("moves upward and negative wheel deltas toward later source time", () => {
    expect(navigateViewportTime(options(-viewportArrowStepPx))).toBe(1_200);
    expect(navigateViewportTime(options(40))).toBe(800);
  });

  it("normalizes pixel, line, and page wheel deltas", () => {
    expect(wheelDeltaPixels(-32, 0, 500)).toBe(-32);
    expect(wheelDeltaPixels(-2, 1, 500)).toBe(-32);
    expect(wheelDeltaPixels(-1, 2, 500)).toBe(-500);
  });

  it("clamps navigation to the chart boundaries", () => {
    expect(navigateViewportTime({ ...options(-40), timeMs: 1_950 })).toBe(2_000);
    expect(navigateViewportTime({ ...options(40), timeMs: 50 })).toBe(0);
  });
});

function options(deltaPixels: number) {
  return {
    chartEndMs: 2_000,
    deltaPixels,
    timeMs: 1_000,
    visualSpeed: 200,
  };
}
