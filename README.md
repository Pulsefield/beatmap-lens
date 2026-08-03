# Beatmap Lens

Beatmap Lens is a small TypeScript library and browser project for examining 4K `osu!mania`
beatmaps. Its first intended consumer is Pulsefield, but the core package contains no
Pulsefield-specific model or run-management logic.

The package is not published, and its API can still change.

## What works today

`beatmap-lens` currently provides:

- a tolerant `.osu` parser that preserves source lines and structured diagnostics;
- a deterministic 4K mania model for normal notes and long notes;
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
- Keep the core synchronous, DOM-free, and free of implicit file or network access.
- Keep browser file handling and media transport in the private Inspector app.
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

Current scope is 4K `.osu` parsing, normal and long-note normalization, source and chart
diagnostics, bounded scene creation, and deterministic SVG output.

The next product work is limited to:

- typed, explainable chart findings;
- a browser review loop with explicit `.osu` and audio selection;
- `t ± Xs` navigation, visual speed presets, synchronized playback, seeking, and looping;
- deterministic SVG and JSON evidence for the selected window.

Beatmap Lens is not a beatmap editor, gameplay simulator, difficulty calculator, model runner,
experiment tracker, or general-purpose rhythm-game framework. Canvas, a CLI, a plugin SDK, a query
language, additional key modes, native bindings, and WebAssembly are not commitments. Each needs a
concrete consumer or measured constraint before entering scope.

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
