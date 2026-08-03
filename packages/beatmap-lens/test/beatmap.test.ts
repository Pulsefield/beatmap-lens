import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import { type BeatmapAudio, connectBeatmapAudio, createBeatmap } from "../src/index";

describe("Beatmap", () => {
  it("composes one .osu source into the runtime model without requiring audio", () => {
    const beatmap = createBeatmap({
      osuFilename: "foundation.osu",
      osuSource: foundation4k,
    });

    expect(beatmap.osuFilename).toBe("foundation.osu");
    expect(beatmap.audioFilename).toBe("foundation.mp3");
    expect(beatmap.audio).toBeUndefined();
    expect(beatmap.chart.keyCount).toBe(4);
    expect(beatmap.chart.notes).toHaveLength(4);
  });

  it("connects an audio object by reference without mutating the source beatmap", () => {
    const audio: BeatmapAudio = {
      filename: "foundation.mp3",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
    };
    const createdWithAudio = createBeatmap({ osuSource: foundation4k, audio });
    const beatmap = createBeatmap({ osuSource: foundation4k });
    const connected = connectBeatmapAudio(beatmap, audio);

    expect(createdWithAudio.audio).toBe(audio);
    expect(beatmap.audio).toBeUndefined();
    expect(connected.audio).toBe(audio);
    expect(connected.document).toBe(beatmap.document);
    expect(connected.chart).toBe(beatmap.chart);
  });
});
