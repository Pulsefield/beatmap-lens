import { describe, expect, it } from "vitest";
import {
  advanceViewportAutoScroll,
  viewportAutoScrollVelocityMsPerSecond,
  viewportEdgePenetration,
  viewportPointerY,
} from "./viewport-auto-scroll";

describe("viewport auto-scroll", () => {
  const rect = {
    top: 100,
    bottom: 500,
    height: 400,
  };

  it("clamps captured pointer Y to the rendered viewport rect before SVG projection", () => {
    expect(viewportPointerY({ clientY: 260, rect, viewportHeight: 800 })).toEqual({
      clampedClientY: 260,
      viewportY: 320,
    });
    expect(viewportPointerY({ clientY: 40, rect, viewportHeight: 800 })).toEqual({
      clampedClientY: 100,
      viewportY: 0,
    });
    expect(viewportPointerY({ clientY: 560, rect, viewportHeight: 800 })).toEqual({
      clampedClientY: 500,
      viewportY: 800,
    });
  });

  it("uses a forty-pixel edge zone and treats outside coordinates as full penetration", () => {
    expect(viewportEdgePenetration({ clientY: 120, rect })).toEqual({
      edge: "top",
      penetrationPx: 20,
      penetrationRatio: 0.5,
    });
    expect(viewportEdgePenetration({ clientY: 80, rect })).toEqual({
      edge: "top",
      penetrationPx: 40,
      penetrationRatio: 1,
    });
    expect(viewportEdgePenetration({ clientY: 480, rect })).toEqual({
      edge: "bottom",
      penetrationPx: 20,
      penetrationRatio: 0.5,
    });
    expect(viewportEdgePenetration({ clientY: 520, rect })).toEqual({
      edge: "bottom",
      penetrationPx: 40,
      penetrationRatio: 1,
    });
    expect(viewportEdgePenetration({ clientY: 260, rect })).toBeUndefined();
  });

  it("squares edge penetration into signed viewport-duration velocity", () => {
    expect(
      viewportAutoScrollVelocityMsPerSecond(
        { edge: "top", penetrationPx: 20, penetrationRatio: 0.5 },
        2_000,
      ),
    ).toBe(500);
    expect(
      viewportAutoScrollVelocityMsPerSecond(
        { edge: "bottom", penetrationPx: 20, penetrationRatio: 0.5 },
        2_000,
      ),
    ).toBe(-500);
    expect(
      viewportAutoScrollVelocityMsPerSecond(
        { edge: "top", penetrationPx: 40, penetrationRatio: 1 },
        2_000,
      ),
    ).toBe(2_000);
  });

  it("advances playhead by frame delta while preserving the signed actual delta", () => {
    expect(
      advanceViewportAutoScroll({
        playheadMs: 1_000,
        elapsedMs: 200,
        chartEndMs: 5_000,
        viewportDurationMs: 2_000,
        penetration: { edge: "top", penetrationPx: 20, penetrationRatio: 0.5 },
      }),
    ).toEqual({
      playheadMs: 1_100,
      deltaMs: 100,
      velocityMsPerSecond: 500,
    });
  });

  it("clamps auto-scroll at chart start and end", () => {
    expect(
      advanceViewportAutoScroll({
        playheadMs: 4_900,
        elapsedMs: 1_000,
        chartEndMs: 5_000,
        viewportDurationMs: 2_000,
        penetration: { edge: "top", penetrationPx: 40, penetrationRatio: 1 },
      }),
    ).toEqual({
      playheadMs: 5_000,
      deltaMs: 100,
      velocityMsPerSecond: 2_000,
    });
    expect(
      advanceViewportAutoScroll({
        playheadMs: 50,
        elapsedMs: 1_000,
        chartEndMs: 5_000,
        viewportDurationMs: 2_000,
        penetration: { edge: "bottom", penetrationPx: 40, penetrationRatio: 1 },
      }),
    ).toEqual({
      playheadMs: 0,
      deltaMs: -50,
      velocityMsPerSecond: -2_000,
    });
  });
});
