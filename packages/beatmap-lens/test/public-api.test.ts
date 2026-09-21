import { describe, expect, it } from "vitest";
import * as beatmapLens from "../src/index";
import * as beatmapLensNode from "../src/node";

describe("public API", () => {
  it("keeps the root runtime surface intentional", () => {
    expect(Object.keys(beatmapLens).sort()).toEqual([
      "connectBeatmapAudio",
      "createAnimationScene",
      "createRenderAnimation",
      "createRenderDocument",
      "createRenderScene",
      "iterateAnimationFrames",
      "iterateOsz",
      "osuLazerManiaPixelsPerSecond",
      "parseBeatmap",
      "parseOsu",
      "parseOsz",
      "projectTime",
      "renderDefaults",
      "renderSvg",
      "renderSvgPages",
      "serializeSvg",
      "serializeSvgPages",
      "toManiaChart",
      "unprojectTime",
    ]);
  });

  it("isolates native encoding behind the Node entry", () => {
    expect(Object.keys(beatmapLensNode).sort()).toEqual(["encodeAnimation", "renderAnimation"]);
  });
});
