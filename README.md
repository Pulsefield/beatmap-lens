# Beatmap Lens

Beatmap Lens is a small TypeScript package and browser project for examining `osu!mania`
beatmaps. The core package supports 4K-10K charts, while the Inspector's first-priority product
support targets 4K-7K. Its first intended consumer is Pulsefield, but the core package contains
no Pulsefield-specific model or run-management logic.

The package is not published, and its API can still change.

## What works today

`beatmap-lens` currently provides:

- a tolerant `.osu` parser that preserves source lines and structured diagnostics;
- an in-memory `.osz` parser that builds audio-linked beatmap sets;
- a runtime `Beatmap` model with optional, shared audio resources;
- a deterministic 4K-10K mania model for normal notes and long notes;
- bounded time-range projection into a render scene;
- DOM-free SVG serialization;
- fixtures, unit tests, corpus invariants, and a private browser app for static inspection.

It does not yet provide semantic chart-quality rules, audio playback, clickable findings, or a
`t ± Xs` review loop. Documentation should not describe those as shipped features.

## Direction

Beatmap Lens is an evidence layer for generated beatmaps. Two workflows define the product.

### Programmatic inspection

Pulsefield or another generator supplies `.osu` text. Beatmap Lens should return typed,
explainable findings with note, time, and source locations. A finding is useful in generation
tests and CI without reducing chart quality to one opaque score.

### Human review

A reviewer supplies a `.osu` file, its audio, a target time, a window radius, and a visual speed
preset. The Inspector should play, seek, and loop the `t ± Xs` region while one media clock keeps
audio and notes synchronized. Visual speed must not change audio playback rate.

Model-version and corpus comparisons should compose programmatic inspection with human review.
Experiment tracking, model execution, storage, and dashboards belong outside this repository.

## Design constraints

- Keep one publishable package with a small root export.
- Keep parsing, normalization, analysis, scene creation, and serialization as explicit stages.
- Treat key count as chart data. Package-level models and stages cover every integer key count
  from 4 through 10 without separate per-key-count APIs.
- Keep the core DOM-free and free of implicit file or network access. CPU-heavy archive inflation
  may be asynchronous and explicitly throttled.
- Keep browser file handling and media transport in the private Inspector app.
- Keep the Inspector's 4K-7K priority at the application boundary; it must not narrow the
  package's 4K-10K contract.
- Let one render scene drive browser presentation and SVG output.
- Prefer direct, composable primitives. Put archive resource policy on each load operation until a
  real stateful consumer proves the need for a longer-lived coordinator.
- Add package, adapter, plugin, and backend boundaries only after a real consumer proves the
  dependency and release boundary.

## Current API

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

// Advanced path: keep the parser, normalized chart, scene, and serializer boundaries explicit.
const parsedOsu = parseOsu(osuSource);
const chart = toManiaChart(parsedOsu);
const scene = createRenderScene(chart, { range: chart.range });
const sameSvg = serializeSvg(scene);

const beatmapSet = await parseOsz(oszBytes);

for await (const loadedBeatmap of iterateOsz(oszBytes, { maxConcurrency: 1 })) {
  // Each yielded beatmap already points to its audio when the archive contains it.
}
```

Every render describes one bounded, contiguous source-time interval. `range` is the only required
`RenderSceneOptions` field and follows half-open `[startMs, endMs)` membership; pass `chart.range`
when the intentional operation is a complete-chart render. It is never inferred by a zero-option
call. Render time runs from bottom to top by default: `startMs` is at the lower edge and later time
appears progressively higher. Pass `timeDirection: "top-to-bottom"` for the opposite presentation.

The remaining scene options are optional. `pixelsPerSecond` defaults to `240`, and `playfield`
defaults to `{ widthPx: 640 }`. When supplied, `playfield` accepts exactly one of the complete scene
`widthPx` or a per-lane `laneWidthPx`. The complete metric and serializer defaults are listed in the
[package README](./packages/beatmap-lens/README.md#render-defaults).

```ts
const excerpt = renderSvg(
  beatmap.chart,
  {
    range: { startMs: 60_000, endMs: 75_000 },
    playfield: { laneWidthPx: 72 },
    theme: {
      metrics: {
        paddingPx: { top: 32, bottom: 32 },
        noteHeightPx: 10,
      },
    },
  },
  { title: "60s to 75s" },
);
```

### osu!lazer mania visual speed

`osuLazerManiaPixelsPerSecond` converts lazer's mania scroll-speed setting and effective landscape
gameplay viewport into the baseline linear scale consumed by `renderSvg`:

```ts
import { osuLazerManiaPixelsPerSecond, renderSvg } from "beatmap-lens";

const pixelsPerSecond = osuLazerManiaPixelsPerSecond({
  scrollSpeed: 22,
  gameplayViewport: { widthPx: 1710, heightPx: 1112 },
}); // ≈ 1783.944 px/s

const svg = renderSvg(beatmap.chart, {
  range: { startMs: 60_000, endMs: 70_000 },
  pixelsPerSecond,
});
```

Pass the final landscape gameplay rectangle. Its dimensions and the returned speed use the same
pixel coordinate space; physical DPI/PPI is not an input.

`theme.metrics` is a nested, partial geometry override; unspecified metrics keep their renderer
defaults. SVG-only metadata such as `title` belongs to the separate third argument of `renderSvg`
or the second argument of `serializeSvg`, never to scene geometry.

Use the scene's canonical projection instead of reimplementing time-to-Y arithmetic:

```ts
import { projectTime, unprojectTime } from "beatmap-lens";

const yPx = projectTime(scene.projection, chart.range.startMs);
const sourceMs = unprojectTime(scene.projection, yPx);
```

These helpers use scene-local Y coordinates. Their geometric domain includes both projection
endpoints, while note membership remains half-open; non-finite or out-of-domain inputs throw
`RangeError`.

The stages expose lower-level data when a caller needs it. The planned convenience inspection API
will compose them; it will not hide I/O or browser state inside the package. `parseBeatmap` accepts
an optional `BeatmapAudio`, and `connectBeatmapAudio` returns a new beatmap that points to the exact
audio object supplied by the caller.

`await parseOsz(bytes)` returns a `BeatmapSet`. Each supported 4K-10K mania difficulty points to its
referenced audio object, and difficulties that share one file share the same object and byte array.
`iterateOsz(bytes)` exposes the same work as an async iterator and yields complete beatmaps one at a
time. Archive loading extracts `.osu` entries and only their referenced audio; it does not load
backgrounds, videos, hitsounds, or unrelated archive resources.

The loader caps selected uncompressed data at 256 MiB and runs at most two inflations concurrently
by default. Set `maxInflatedBytes` to another finite non-negative budget and `maxConcurrency` from 1
through 8 to make the memory/throughput tradeoff explicit for a device. `File`, `Blob`, object URLs,
media elements, playback clocks, and their cleanup remain application responsibilities. Audio byte
arrays are shared by reference and are never copied or mutated by Beatmap Lens after connection.

Archive entry names currently use the ZIP library's UTF-8 decoding. Legacy Shift-JIS filename
fallback is not included in this first archive implementation.

## Architecture

```text
.osu text -> parseBeatmap -> Beatmap -> Beatmap.chart -> renderSvg

.osu text -> parseOsu -> ParsedOsu -> toManiaChart -> ManiaChart
                                                       |
                                                       v
                                              createRenderScene
                                                       |
                                                       v
                                                  RenderScene
                                                       |
                                                       v
                                                  serializeSvg

.osz bytes -> iterateOsz -> Beatmap
           +-> parseOsz -> BeatmapSet -> Beatmap[] + shared BeatmapAudio[]
```

`renderSvg(chart, sceneOptions, svgOptions?)` is exactly the shortcut for
`serializeSvg(createRenderScene(chart, sceneOptions), svgOptions)`. Future analysis will read
`ManiaChart` and produce structured findings beside the rendering path.

The workspace has one release boundary:

```text
apps/
  inspector/          private first-party browser surface

packages/
  beatmap-lens/       only publishable package

fixtures/
  beatmaps/           redistributable parser and render fixtures
```

The current Inspector is a static development surface. Its name describes the product boundary,
not completion of the audio review workflow.

## Scope

The package foundation supports every integer key count from 4K through 10K across normalization,
source and chart diagnostics, bounded scene creation, and deterministic SVG output. Valid
`osu!mania` files derive their key count from `[Difficulty] CircleSize`.

The package contract is:

- derive and preserve the supported source key count instead of coercing non-4K charts into four
  columns;
- use one `ManiaChart`, render-scene, analysis, and serialization pipeline for 4K-10K charts;
- keep key count in data rather than public API names or key-count-specific model variants;
- verify the same invariants for each supported key count from 4 through 10.

The Inspector's first-priority support range is 4K-7K. Its review workflow, layout, fixtures, and
acceptance checks should cover that range first. Valid 8K-10K charts remain package-level
requirements, but polished Inspector support for them is a later app milestone and must not block
the first 4K-7K app release.

With the package's 4K-10K normalization, archive, and rendering contract in place, the next product
work is:

1. add typed, explainable chart findings on the same 4K-10K model;
2. connect the Inspector's 4K-7K file import to the runtime beatmap model and build the browser
   review loop with `t ± Xs` navigation, visual speed presets, synchronized playback, seeking, and
   looping;
3. emit deterministic SVG and JSON evidence for the selected window.

Beatmap Lens is not a beatmap editor, gameplay simulator, difficulty calculator, model runner,
experiment tracker, or general-purpose rhythm-game framework. Canvas, a CLI, a plugin SDK, a query
language, key modes outside 4K-10K, native bindings, and WebAssembly are not commitments. Each
needs a concrete consumer or measured constraint before entering scope.

One `RenderScene` deliberately remains one contiguous range and one playfield. Maximum width or
height solving, density-aware scale selection, horizontal multi-playfield flow, pagination, full
osu! scroll-speed parity, and PNG or other raster output are deferred policy/backend layers. They
are not options or capabilities of the current renderer.

## Development

Requirements:

- Node.js 22.18 or newer on the 22.x line, or Node.js 24.11 or newer;
- pnpm 11 or newer.

```bash
pnpm install
pnpm check
pnpm dev
pnpm benchmark
```

To run deterministic parser, model, and SVG checks against a local corpus:

```bash
pnpm validate:corpus -- /path/to/beatmaps --sample 512
```

The corpus path stays local. Do not commit local beatmaps, filenames, indexes, or generated reports.

See [CONTRIBUTING.md](CONTRIBUTING.md) for boundary and verification rules.

## License

MIT
