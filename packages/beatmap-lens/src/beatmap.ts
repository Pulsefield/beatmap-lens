import { toManiaChart } from "./mania.js";
import { getLastPropertyValue, parseOsu } from "./parser.js";
import type { Beatmap, BeatmapAudio, ParseBeatmapOptions } from "./types.js";

export function parseBeatmap(osuSource: string, options: ParseBeatmapOptions = {}): Beatmap {
  const document = parseOsu(osuSource);
  const audioFilename = getLastPropertyValue(document, "General", "AudioFilename");
  const beatmap: Beatmap = {
    osuSource,
    ...(options.filename !== undefined ? { osuFilename: options.filename } : {}),
    document,
    chart: toManiaChart(document),
    ...(audioFilename !== undefined ? { audioFilename } : {}),
  };

  return options.audio ? connectBeatmapAudio(beatmap, options.audio) : beatmap;
}

export function connectBeatmapAudio(beatmap: Beatmap, audio: BeatmapAudio): Beatmap {
  return { ...beatmap, audio };
}
