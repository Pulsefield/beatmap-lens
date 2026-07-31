# Beatmap Lens

Beatmap Lens is an early-stage TypeScript toolkit for parsing, inspecting, and rendering `osu!mania` beatmaps.

The project is designed for workflows where beatmaps need to be checked programmatically: generated charts, fixture suites, review tools, lightweight previews, and diagnostics that another program can consume.

## Status

Beatmap Lens is being bootstrapped. The package is not published to npm, the public API is not stable, and no command-line interface is implemented.

The current foundation is the repository and package shape:

- TypeScript-first, ESM-first library design.
- One public package at `packages/beatmap-lens`.
- pnpm workspace scripts for build, test, source checks, benchmarks, and release preparation.
- MIT licensing.

The current code foundation includes:

- `parseOsu`, a tolerant `.osu` parser that preserves source lines, sections, properties, hit objects, and diagnostics.
- `toManiaChart`, a 4K `osu!mania` normalizer for normal notes, long notes, metadata, and chart diagnostics.
- `createRenderScene`, a backend-neutral render scene builder for lanes, note glyphs, viewport timing, and diagnostics.
- `renderSvg`, a convenience renderer from a chart or scene to SVG.
- `serializeSvg`, the DOM-free serializer for an existing render scene.
- Parser, mania conversion, render scene, and SVG tests.
- A Vue 3 and Vite playground with an editable sample map and SVG preview.

The roadmap includes analysis rules, query helpers, a thin CLI, Canvas rendering, watch mode, broader benchmarks, and possible Python or native bindings later. Those are not current capabilities.

## Installation

Beatmap Lens has not been published yet.

Once an initial package is released:

```bash
pnpm add beatmap-lens
```

or:

```bash
npm install beatmap-lens
```

Until then, use this repository as design documentation and local development source.

## Current API

The API is early and may change before the first release.

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

const scene = createRenderScene(chart, {
  startTime: 60_000,
  endTime: 75_000,
  width: 640,
  pixelsPerSecond: 240,
});

const svg = renderSvg(chart, {
  startTime: 60_000,
  endTime: 75_000,
  width: 640,
  pixelsPerSecond: 240,
});

const sameSvg = serializeSvg(scene);
```

The core API does not read files implicitly. Applications can supply beatmap text from the filesystem, uploads, archives, network requests, or generated output.

Current parser and chart diagnostics use structured data rather than only drawing warnings on an image:

```ts
interface OsuDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  line?: number;
  section?: string;
  value?: string;
}
```

## Architecture

```text
.osu source
    |
    v
tolerant parser
    |
    v
source document
    |
    v
normalized mania chart
    |
    +---------------------> planned analysis and query rules
    |                              |
    |                              v
    |                         diagnostics
    |
    v
viewport projection
    |
    v
backend-neutral render scene
    |
    +---------------------> SVG renderer
    |
    +---------------------> future Canvas renderer
```

Parser, normalization, analysis, scene creation, and serialization are separate boundaries. A malformed source file can still produce source diagnostics. A renderer should consume a scene, not reinterpret raw `.osu` text.

## Scope

Current scope:

- `.osu` file parsing.
- `osu!mania` charts, with 4K as the first supported target.
- Normal notes and long notes.
- Time-range rendering.
- Backend-neutral scene creation.
- SVG serialization.
- Structured diagnostics for source and chart problems.
- Fixtures and tests for parser, normalization, and rendering behavior.
- Basic browser playground for a bundled 4K sample.

Later scope:

- Typed analysis rules.
- Structured query helpers.
- A thin Node.js CLI over the public library API.
- Canvas rendering.
- Benchmarks for parser, analysis, and rendering paths.

## Non-goals

Beatmap Lens is not planned as:

- a complete beatmap editor;
- an `osu!` client or gameplay simulator;
- a replacement for every difficulty or performance calculator;
- a large desktop application;
- a visual programming environment for analysis rules;
- an exact reimplementation of every internal `osu!` behavior.

A textual query language is also not an immediate goal. Typed rules and structured results should come first.

## Development

Requirements:

- Node.js 22.18 or newer on the 22.x line, or Node.js 24.11 or newer.
- pnpm 11 or newer.

The repository uses pnpm workspaces, tsdown, Vitest, Biome, Changesets, Vue 3, and Vite. The root scripts currently define this local interface:

```bash
pnpm install
pnpm check:source
pnpm check
pnpm test
pnpm test:watch
pnpm build
pnpm dev
pnpm benchmark
```

To exercise the parser, normalizer, and a bounded SVG viewport against a local beatmap corpus,
pass its directory at runtime:

```bash
pnpm validate:corpus -- /path/to/beatmaps
```

For a faster deterministic sample:

```bash
pnpm validate:corpus -- /path/to/beatmaps --sample 512
```

The corpus path is never stored in project configuration. Local beatmaps, filenames, and generated
corpus reports should not be committed.

Repository shape:

```text
apps/
  playground/

packages/
  beatmap-lens/

fixtures/
  beatmaps/

```

## Testing

Testing should cover behavior at each boundary:

- parser fixtures for valid input, malformed input, timing sections, normal notes, and long notes;
- golden normalization tests for stable `ManiaChart` output;
- scene and SVG snapshots that prefer semantic stability over formatting details;
- invariants such as sorted objects, valid columns, long notes ending after they start, and rendering without chart mutation;
- benchmarks before introducing Rust, WebAssembly, worker threads, TypedArrays, or native bindings.

## Roadmap

### 0.1 Foundation

- [x] tolerant `.osu` parser;
- [x] source document model;
- [x] normalized `ManiaChart`;
- [x] 4K note and long-note support;
- [x] backend-neutral render scene;
- [x] SVG renderer;
- [x] parser and renderer fixtures.

### 0.2 Inspection

- [ ] typed analysis rules;
- [ ] structured query matches;
- [ ] minimum note interval rule;
- [ ] empty-span rule;
- [ ] same-column overlap rule;
- [ ] JSON diagnostics output;
- [ ] basic CLI.

### 0.3 Interactive Workflow

- [x] basic browser playground;
- [ ] Canvas renderer;
- [ ] time-range navigation;
- [ ] clickable diagnostics;
- [ ] incremental directory watching;
- [ ] rendering and analysis benchmarks.

### Later

- [ ] plugin API for custom rules;
- [ ] corpus-level summaries;
- [ ] comparison between generated beatmaps;
- [ ] additional key modes;
- [ ] stable textual query syntax, if the typed API proves the semantics;
- [ ] Python integration, if a concrete consumer needs it;
- [ ] native or WebAssembly acceleration, if profiling justifies it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short, proposed changes should describe the beatmap workflow they improve and should keep parser, model, analysis, and rendering concerns separate.

## License

Beatmap Lens is licensed under the MIT License. See [LICENSE](LICENSE).
