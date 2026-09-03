# beatmap-lens

A pre-release TypeScript toolkit for 4K-10K `osu!mania` beatmaps.

The package is not published, and its API can still change.

```ts
import {
  createRenderScene,
  iterateOsz,
  parseBeatmap,
  parseOsz,
  parseOsu,
  renderSvg,
  serializeSvg,
  toManiaChart,
} from "beatmap-lens";

const beatmap = parseBeatmap(osuSource);
const sceneOptions = {
  range: beatmap.chart.range,
};
const svg = renderSvg(beatmap.chart, sceneOptions);

// Advanced path: use each stage independently.
const parsedOsu = parseOsu(osuSource);
const chart = toManiaChart(parsedOsu);
const scene = createRenderScene(chart, { range: chart.range });
const sameSvg = serializeSvg(scene);

const beatmapSet = await parseOsz(oszBytes);

for await (const loadedBeatmap of iterateOsz(oszBytes, { maxConcurrency: 1 })) {
  // Each beatmap is complete and already linked to its shared audio when present.
}
```

`parseBeatmap` is the ordinary entry point: retain its `Beatmap`, then pass `beatmap.chart` to
`renderSvg`. `parseOsu`/`toManiaChart` and `createRenderScene`/`serializeSvg` remain the advanced,
composable boundaries.

Every render describes one bounded, contiguous source-time interval. `range` is the only required
`RenderSceneOptions` field and uses half-open `[startMs, endMs)` membership. Use `chart.range` for
an intentional complete-chart render; there is no zero-option, implicitly unbounded render. Time
runs from bottom to top by default, placing `startMs` at the lower edge and later time progressively
higher. Set `timeDirection: "top-to-bottom"` for the opposite presentation.

`pixelsPerSecond`, `playfield`, `timeDirection`, and `theme` are optional. The linear scale defaults
to `240 px/s`, while the playfield defaults to the complete scene size `{ widthPx: 640 }`. A supplied
playfield must choose exactly one sizing mode:

```ts
const sceneOptions = {
  range: { startMs: 60_000, endMs: 75_000 },
  playfield: { laneWidthPx: 72 }, // Or: { widthPx: 640 }, never both.
  theme: {
    metrics: {
      paddingPx: { top: 32, bottom: 32 },
      laneGapPx: 6,
      noteHeightPx: 10,
    },
  },
};

const svg = renderSvg(beatmap.chart, sceneOptions, { title: "60s to 75s" });
```

`theme.metrics` is nested and partial: unspecified padding sides and metrics retain their defaults.
SVG-only metadata such as `title` is a separate serializer option, accepted by the third argument
of `renderSvg` or the second argument of `serializeSvg`.

### Render defaults

| Input | Required | Default |
| --- | --- | --- |
| `range` | Yes | None; use `chart.range` intentionally for the complete chart |
| `pixelsPerSecond` | No | `240` |
| `playfield` | No | `{ widthPx: 640 }` |
| `timeDirection` | No | `"bottom-to-top"` |
| `theme.metrics.paddingPx` | No | `{ top: 24, right: 16, bottom: 24, left: 16 }` |
| `theme.metrics.laneGapPx` | No | `4` |
| `theme.metrics.noteHeightPx` | No | `8` |
| `theme.metrics.noteInsetPx` | No | `5` |
| `theme.metrics.noteRadiusPx` | No | `2` |
| serializer `title` | No | Metadata artist/title/version plus the key-count label; the key-count label alone when metadata is absent |

Use the scene's canonical projection for every time/scene coordinate conversion:

```ts
import { projectTime, unprojectTime } from "beatmap-lens";

const yPx = projectTime(scene.projection, chart.range.startMs);
const sourceMs = unprojectTime(scene.projection, yPx);
```

`projectTime` and `unprojectTime` use scene-local Y coordinates. Their geometric domain is closed,
so both projection endpoints are valid even though note membership is half-open. Non-finite or
out-of-domain inputs throw `RangeError`. `RenderScene` retains resolved numeric precision; the SVG
serializer preserves finite JavaScript numeric values when encoding text.

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

One `RenderScene` intentionally covers one range and one playfield. Maximum dimension solving,
automatic readable-scale selection, horizontal multi-playfield layout, pagination, osu! scroll-speed
adapters, and PNG/raster output are deferred layers rather than current renderer options.
