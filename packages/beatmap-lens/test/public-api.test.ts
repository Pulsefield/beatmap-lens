import { describe, expect, it } from "vitest";
import * as beatmapLens from "../src/index";

describe("public API", () => {
  it("keeps the root runtime surface intentional", () => {
    expect(Object.keys(beatmapLens).sort()).toEqual([
      "connectBeatmapAudio",
      "createBeatmap",
      "createRenderScene",
      "iterateOsz",
      "parseOsu",
      "parseOsz",
      "renderSvg",
      "serializeSvg",
      "toManiaChart",
    ]);
  });
});
