import { toManiaChart } from "./mania.js";
import { getLastPropertyValue, parseOsu } from "./parser.js";
import type { Beatmap, BeatmapAudio, BeatmapInput } from "./types.js";

export function createBeatmap(input: BeatmapInput): Beatmap {
  const document = parseOsu(input.osuSource);
  const audioFilename = getLastPropertyValue(document, "General", "AudioFilename");
  const beatmap: Beatmap = {
    osuSource: input.osuSource,
    ...(input.osuFilename !== undefined ? { osuFilename: input.osuFilename } : {}),
    document,
    chart: toManiaChart(document),
    ...(audioFilename !== undefined ? { audioFilename } : {}),
  };

  return input.audio ? connectBeatmapAudio(beatmap, input.audio) : beatmap;
}

export function connectBeatmapAudio(beatmap: Beatmap, audio: BeatmapAudio): Beatmap {
  return { ...beatmap, audio };
}
