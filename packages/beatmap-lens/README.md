# beatmap-lens

A pre-release TypeScript toolkit for 4K-10K `osu!mania` beatmaps.

The package is not published, and its API can still change.

```ts
import {
  createBeatmap,
  createRenderScene,
  iterateOsz,
  parseOsz,
  parseOsu,
  renderSvg,
  serializeSvg,
  toManiaChart,
} from "beatmap-lens";

const document = parseOsu(osuSource);
const chart = toManiaChart(document);
const beatmap = createBeatmap({ osuSource });
const beatmapSet = await parseOsz(oszBytes);
const options = {
  startTime: 0,
  endTime: 15_000,
  width: 640,
  pixelsPerSecond: 240,
};

const scene = createRenderScene(chart, options);
const svg = renderSvg(chart, options);
const sameSvg = serializeSvg(scene);

for await (const loadedBeatmap of iterateOsz(oszBytes, { maxConcurrency: 1 })) {
  // Each beatmap is complete and already linked to its shared audio when present.
}
```

The package is ESM-only, DOM-free, and performs no implicit file or network reads. It detects the
key count of valid `osu!mania` files from `[Difficulty] CircleSize` and supports 4K-10K normal
notes, long notes, bounded render scenes, SVG serialization, and in-memory `.osz` archives.

`Beatmap` composes `.osu` source, its parsed document, its normalized chart, and an optional pointer
to `BeatmapAudio`. `connectBeatmapAudio` creates that connection without copying audio bytes.
`parseOsz` asynchronously returns a `BeatmapSet` whose difficulties already point to shared
referenced audio objects. Missing audio is valid and leaves the pointer undefined. `iterateOsz`
yields the same complete beatmaps one at a time when a caller does not need to wait for the whole
set.

Archive loading inflates `.osu` entries and only audio referenced by supported beatmaps. It never
loads backgrounds, videos, hitsounds, or unrelated audio. Inflation is asynchronous and limited to
two concurrent entries by default. Set `maxConcurrency` from 1 through 8 to trade throughput for
transient memory use.

The cumulative uncompressed size selected from one archive is capped at 256 MiB by default. Set
`maxInflatedBytes` on `parseOsz` or `iterateOsz` to choose another finite non-negative budget. The
loader rejects before crossing the limit; `NaN`, infinity, and negative budgets are invalid.

Archive entry names currently use UTF-8 decoding; legacy Shift-JIS filename fallback is not yet
included.

Audio byte arrays are shared by reference and are never copied or mutated by Beatmap Lens after
connection. Callers remain responsible for the arrays and for any browser resources created from
them.

The package boundary is every integer key count from 4K through 10K. The normalized chart,
diagnostics, render scene, analysis, and serialization stages share one key-count-aware pipeline
rather than separate per-key-count APIs. The first-party Inspector prioritizes 4K-7K at the app
layer; that narrower delivery priority does not reduce the package range.

Semantic chart-quality findings and synchronized audio playback remain project direction, not
current package features. See the [repository](https://github.com/Pulsefield/beatmap-lens) for the
status and architecture.
