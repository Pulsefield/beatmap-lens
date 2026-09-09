import { describe, expect, it } from "vitest";
import { resolvePlaybackRate, SUPPORTED_PLAYBACK_RATES } from "./playback-rate";

describe("annotation playback rates", () => {
  it("resolves historical judgments as 1x and permits the requested comparison speeds", () => {
    expect(resolvePlaybackRate()).toBe(1);
    expect(SUPPORTED_PLAYBACK_RATES.map(resolvePlaybackRate)).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
    expect(() => resolvePlaybackRate(2)).toThrow("Unsupported playback rate");
  });
});
