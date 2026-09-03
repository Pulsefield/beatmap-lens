import { describe, expect, it } from "vitest";
import { osuLazerManiaPixelsPerSecond } from "../src/index.js";

describe("osu!lazer mania speed adapter", () => {
  it.each([
    [{ scrollSpeed: 1, gameplayViewport: { widthPx: 1024, heightPx: 768 } }, 56.003482803656944],
    [{ scrollSpeed: 22, gameplayViewport: { widthPx: 1710, heightPx: 1112 } }, 1783.9442751414892],
    [{ scrollSpeed: 8, gameplayViewport: { widthPx: 1280, heightPx: 720 } }, 420.02612102742705],
    [{ scrollSpeed: 10, gameplayViewport: { widthPx: 1280, heightPx: 1024 } }, 700.0435350457118],
  ] as const)("matches lazer's landscape geometry for %o", (options, expected) => {
    expect(osuLazerManiaPixelsPerSecond(options)).toBeCloseTo(expected, 12);
  });

  it("keeps CSS and framebuffer coordinate spaces proportional", () => {
    const cssSpeed = osuLazerManiaPixelsPerSecond({
      scrollSpeed: 20,
      gameplayViewport: { widthPx: 1440, heightPx: 900 },
    });
    const framebufferSpeed = osuLazerManiaPixelsPerSecond({
      scrollSpeed: 20,
      gameplayViewport: { widthPx: 2880, heightPx: 1800 },
    });

    expect(framebufferSpeed).toBe(cssSpeed * 2);
  });

  it.each([
    { scrollSpeed: 0, gameplayViewport: { widthPx: 1920, heightPx: 1080 } },
    { scrollSpeed: 40.1, gameplayViewport: { widthPx: 1920, heightPx: 1080 } },
    { scrollSpeed: 8, gameplayViewport: { widthPx: 0, heightPx: 1080 } },
    { scrollSpeed: 8, gameplayViewport: { widthPx: 1080, heightPx: 1920 } },
  ])("rejects values outside the supported lazer landscape domain: %o", (options) => {
    expect(() => osuLazerManiaPixelsPerSecond(options)).toThrowError(RangeError);
  });
});
