# Beatmap Lens

Beatmap Lens is a small TypeScript package and browser project for examining `osu!mania`
beatmaps. The core package supports 4K-10K charts, while the Inspector's first-priority product
support targets 4K-7K. Its first intended consumer is Pulsefield, but the core package contains
no Pulsefield-specific model or run-management logic.

The package is not published, and its API can still change.

## What works today

`beatmap-lens` currently provides:

- a tolerant `.osu` parser that preserves source lines and structured diagnostics;
- a deterministic 4K-10K mania model for normal notes and long notes;
- bounded time-range projection into a render scene;
- DOM-free SVG serialization;
- fixtures, unit tests, corpus invariants, and a private browser app for static inspection.

It does not yet provide semantic chart-quality rules, synchronized audio playback, clickable
findings, or a `t ± Xs` review loop. Documentation should not describe those as shipped features.

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
- Keep the core synchronous, DOM-free, and free of implicit file or network access.
- Keep browser file handling and media transport in the private Inspector app.
- Keep the Inspector's 4K-7K priority at the application boundary; it must not narrow the
  package's 4K-10K contract.
- Let one render scene drive browser presentation and SVG output.
- Prefer a direct default API plus composable primitives over stateful builders or service
  containers.
- Add package, adapter, plugin, and backend boundaries only after a real consumer proves the
  dependency and release boundary.

## Current API

```ts
import {
  createRenderScene,
  parseOsu,
  renderSvg,
  serializeSvg,
  toManiaChart,
} from "beatmap-lens";

const document = parseOsu(osuSource);
const chart = toManiaChart(document);

const viewport = {
  startTime: 60_000,
  endTime: 75_000,
  width: 640,
  pixelsPerSecond: 240,
};

const scene = createRenderScene(chart, viewport);
const svg = renderSvg(chart, viewport);
const sameSvg = serializeSvg(scene);
```

The stages expose lower-level data when a caller needs it. The planned convenience inspection API
will compose them; it will not hide I/O or browser state inside the package.

## Architecture

```text
.osu text
   |
   v
parseOsu -> ParsedOsu -> toManiaChart -> ManiaChart
                                             |
                                             v
                                  createRenderScene
                                             |
                                             v
                                        RenderScene
                                             |
                                             v
                                        serializeSvg
```

`renderSvg(chart, options)` is the current shortcut from a normalized chart to SVG. Future
analysis will read `ManiaChart` and produce structured findings beside the rendering path.

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

With the package's 4K-10K normalization and rendering contract in place, the next product work is:

1. add typed, explainable chart findings on the same 4K-10K model;
2. build the Inspector's 4K-7K browser review loop with explicit `.osu` and audio selection,
   `t ± Xs` navigation, visual speed presets, synchronized playback, seeking, and looping;
3. emit deterministic SVG and JSON evidence for the selected window.

Beatmap Lens is not a beatmap editor, gameplay simulator, difficulty calculator, model runner,
experiment tracker, or general-purpose rhythm-game framework. Canvas, a CLI, a plugin SDK, a query
language, key modes outside 4K-10K, native bindings, and WebAssembly are not commitments. Each
needs a concrete consumer or measured constraint before entering scope.

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
