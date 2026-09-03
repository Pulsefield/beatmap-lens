# Render API foundation goal

- Status: Accepted
- Date: 2026-09-03

## Goal

Establish a Beatmap-centric, explicitly bounded render API with one canonical source-time-to-scene
projection. The immediate work makes the current linear renderer coherent and safe to compose; it
does not turn Beatmap Lens into a static chart publishing engine.

This goal is complete when the primary and advanced paths are both unambiguous:

```text
Primary path
.osu source -> parseBeatmap -> Beatmap -> Beatmap.chart -> renderSvg

Advanced path
.osu source -> parseOsu -> ParsedOsu -> toManiaChart -> ManiaChart
                                                   -> createRenderScene -> RenderScene
                                                                        -> serializeSvg
```

`Beatmap` is the object ordinary callers keep and pass between package features. `ParsedOsu`,
`ManiaChart`, `createRenderScene`, and `serializeSvg` remain composable advanced primitives.

## Core problem insights

### The package has no clear primary model

The current introductory path presents `parseOsu`, `toManiaChart`, and `createBeatmap` as peers even
though `createBeatmap` already performs parsing and normalization. Its name describes construction
while its behavior is parsing. Callers cannot tell whether `ParsedOsu`, `ManiaChart`, or `Beatmap`
is the durable application model.

The primary operation will therefore be named `parseBeatmap(osuSource, options?)`. Direct parser and
normalizer access stays public for callers that need those boundaries.

### Coordinate projection is duplicated

The renderer projects source milliseconds into scene Y coordinates, while the Inspector separately
reimplements forward projection, inverse pointer projection, range geometry, and playhead
translation. A direction change currently requires coordinated formula changes across package and
application code.

The scene must carry one serializable projection description, and shared pure functions must own
the forward and inverse mapping. Renderer glyphs, Inspector overlays, and pointer mapping must
consume that contract rather than reproduce its arithmetic.

### Render options expose implementation knobs instead of one operation

The current flat options mix range selection, linear scale, playfield sizing, direction, theme
metrics, and SVG metadata. Some combinations conflict: `width` silently wins over `laneWidth`, and
the accepted minimum lane width can produce a zero-width note after the hard-coded inset.

Immediate options will describe one bounded, contiguous scene. Function names—not a large layout
union—will distinguish future document planning and stateful viewport behavior.

### Range and unit semantics are not explicit

Source milliseconds are the canonical render and audio coordinate established by ADR 0001, but
public fields use ambiguous names such as `time`, `startTime`, and `endTime`. Renderer tap-note
filtering also includes `endTime`, while long-note filtering already follows interval-overlap
semantics. Adjacent render ranges can therefore duplicate a tap note at their shared boundary.

All public source-time fields will carry the `Ms` suffix. Render ranges are finite, required, and
half-open: `[startMs, endMs)`. A complete-chart render is an explicit caller choice, not an implicit
zero-option operation.

### Automatic layout is a separate policy layer

Readable-scale resolution, maximum output dimensions, horizontal playfield flow, pagination, and
osu! client scroll emulation all require policy decisions and structured results. They must compose
bounded scenes rather than redefine `RenderScene` or become branches of one renderer option union.

## Decisions

### Primary Beatmap API

Replace the misleading constructor-style entry with:

```ts
export interface ParseBeatmapOptions {
  readonly filename?: string
  readonly audio?: BeatmapAudio
}

export function parseBeatmap(
  osuSource: string,
  options?: ParseBeatmapOptions,
): Beatmap
```

`connectBeatmapAudio` remains available when audio is associated later. Because the package is
unpublished and versioned `0.0.0`, this goal does not retain deprecated `createBeatmap` or
`BeatmapInput` aliases. `filename` maps to the existing, more explicit `Beatmap.osuFilename` field;
`audio` is convenience composition equivalent to calling `connectBeatmapAudio` after parsing.

### Canonical source time and ranges

The package exports one structural runtime range type:

```ts
export interface TimeRange {
  /** Half-open source-time interval [startMs, endMs). */
  readonly startMs: number
  readonly endMs: number
}
```

The following public model fields are renamed in the same breaking change:

```text
OsuHitObject.time                 -> timeMs
ManiaNote.startTime/endTime       -> startMs/endMs
RenderNoteGlyph.startTime/endTime -> startMs/endMs
RenderScene.timeRange             -> RenderScene.projection.range
SVG data-start-time/end-time      -> data-start-ms/end-ms
```

`ManiaChart` exposes a resolved `range: TimeRange` so an intentional complete-chart operation is
expressed as `range: chart.range`. It uses
`startMs = min(0, ...note.startMs)` and
`endMs = max(startMs + 1, ...note.endMs + 1)`, giving every chart a non-empty interval and one
millisecond of exclusive tail space. An empty chart uses `[0, 1)`. First-party `chartRenderRange`
remains an app policy with additional visual tail space, but changes its result fields to
`startMs`/`endMs`.

Persisted Inspector schema names such as `TimeRangeV1` remain versioned. They must preserve the
same structural `[startMs, endMs)` contract without erasing their storage-version identity.

### Bounded scene operation

`RenderScene` always represents one contiguous source-time range and one playfield. Its range is
required:

```ts
export interface RenderSceneOptions {
  readonly range: TimeRange
  readonly pixelsPerSecond?: number
  readonly playfield?: PlayfieldSize
  readonly timeDirection?: RenderTimeDirection
  readonly theme?: RenderThemeInput
}
```

Omitting `pixelsPerSecond`, `playfield`, `timeDirection`, or `theme` selects documented
linear-render defaults. Omitting `range` is a type error and a runtime `RangeError`. This goal keeps
the single current linear scale as one direct scalar instead of inventing a one-member union. A
future osu! adapter produces a generic, self-contained time-distance projection only after
normalized timing/SV data and fidelity tests exist; the renderer does not grow client names.

Playfield width choices are mutually exclusive:

```ts
export type PlayfieldSize =
  | {
      readonly widthPx: number
      readonly laneWidthPx?: never
    }
  | {
      readonly laneWidthPx: number
      readonly widthPx?: never
    }
```

### Canonical projection

The public scene contains a serializable `RenderTimeProjection`, not callbacks supplied by users.
The initial projection is linear and range-bound. Public pure helpers own coordinate conversion:

```ts
export type RenderTimeProjection = LinearRenderTimeProjection

export interface LinearRenderTimeProjection {
  readonly type: "linear"
  readonly range: TimeRange
  readonly direction: RenderTimeDirection
  readonly pixelsPerSecond: number
  readonly contentTopPx: number
  readonly contentHeightPx: number
}

export function projectTime(
  projection: RenderTimeProjection,
  timeMs: number,
): number

export function unprojectTime(
  projection: RenderTimeProjection,
  yPx: number,
): number
```

Projection invariants are:

- Note membership uses `[startMs, endMs)`, while projection helpers use the closed geometric domain
  `[startMs, endMs]` so both visual boundaries are projectable;
- `contentHeightPx = (endMs - startMs) * pixelsPerSecond / 1000` with no implicit minimum height;
- with `d = (timeMs - startMs) * pixelsPerSecond / 1000`, top-to-bottom is
  `contentTopPx + d`, while bottom-to-top is `contentTopPx + contentHeightPx - d`;
- bottom-to-top therefore places `startMs` at the bottom and later time progressively higher,
  while top-to-bottom is strictly increasing;
- `unprojectTime(projection, projectTime(projection, timeMs))` returns `timeMs` within floating
  point tolerance;
- direction changes presentation but not scale or source range;
- helpers throw `RangeError` for non-finite input or input outside their closed time/Y domain; they
  never clamp or extrapolate;
- projection and scene geometry preserve resolved numeric precision; a backend serializer may
  format only while encoding its output and must not collapse finite non-zero geometry to zero or
  produce a non-finite value from finite geometry;
- long notes are clipped in source time before their endpoints are projected.

For `top-to-bottom`, `startMs` projects to `contentTopPx`; for `bottom-to-top`, `endMs` projects to
`contentTopPx`. The lane height equals `contentHeightPx`; removing the old implicit `96px` minimum
ensures short ranges do not silently alter or pad the declared scale.

### Resolved theme metrics

The geometry-affecting constants already present in the renderer become one resolved theme source:

```ts
export interface RenderMetrics {
  readonly paddingPx: RenderPadding
  readonly laneGapPx: number
  readonly noteHeightPx: number
  readonly noteInsetPx: number
  readonly noteRadiusPx: number
}

export interface RenderMetricOptions {
  readonly paddingPx?: Partial<RenderPadding>
  readonly laneGapPx?: number
  readonly noteHeightPx?: number
  readonly noteInsetPx?: number
  readonly noteRadiusPx?: number
}

export interface RenderThemeInput {
  readonly metrics?: RenderMetricOptions
}
```

`widthPx` is the complete scene width, including resolved left and right padding. `laneWidthPx`
sets each lane width and derives that complete scene width. Resolved lane geometry and `size.widthPx`
make the result observable without duplicating a second playfield object on the scene.

The sizing formulas are fixed:

```text
widthPx branch:
  sceneWidthPx = widthPx
  laneRegionWidthPx = sceneWidthPx - padding.left - padding.right
  laneWidthPx = (laneRegionWidthPx - (keyCount - 1) * laneGapPx) / keyCount

laneWidthPx branch:
  laneRegionWidthPx = keyCount * laneWidthPx + (keyCount - 1) * laneGapPx
  sceneWidthPx = padding.left + laneRegionWidthPx + padding.right

vertical:
  projection.contentTopPx = padding.top
  sceneHeightPx = padding.top + projection.contentHeightPx + padding.bottom
```

The scene exposes the resolved metrics used to produce it. Validation checks relationships after
resolution, including `laneWidth > 2 * noteInsetPx`; validating isolated scalar inputs is
insufficient. Palette, fonts, skin assets, and callbacks are not introduced by this goal.

### Resolved scene contract

`RenderScene` is a pixel-space visual IR. Graphics vocabulary such as `x`, `y`, `width`, and
`height` therefore remains concise, while cross-domain time and user sizing inputs carry units.
The resolved public shape is:

```ts
export interface RenderScene {
  readonly kind: "mania"
  readonly keyCount: number
  readonly size: {
    readonly widthPx: number
    readonly heightPx: number
  }
  readonly projection: RenderTimeProjection
  readonly metrics: RenderMetrics
  readonly metadata: ManiaMetadata
  readonly lanes: readonly RenderLane[]
  readonly notes: readonly RenderNoteGlyph[]
}

export interface RenderNoteGlyph {
  // Existing identity, kind, source, column, geometry, and paint fields remain.
  readonly startMs: number
  readonly endMs: number
  readonly continuesBefore: boolean
  readonly continuesAfter: boolean
}
```

`projection` is the only scene source of range, direction, and scale; the old `timeRange`, top-level
`timeDirection`, `width`, `height`, `viewBox`, and `padding` fields are removed. `startMs`/`endMs`
retain the original Note boundaries. Geometry uses clipped endpoints. For taps, both continuation
flags are `false`; for long notes they are computed against the scene range.

### Function boundaries

The target runtime surface keeps operations distinct:

```ts
parseBeatmap(source, options?) -> Beatmap
createRenderScene(chart, options) -> RenderScene
projectTime(projection, timeMs) -> yPx
unprojectTime(projection, yPx) -> timeMs
serializeSvg(scene, svgOptions?) -> string
renderSvg(chart, sceneOptions, svgOptions?) -> string
```

`renderSvg` is exactly equivalent to
`serializeSvg(createRenderScene(chart, sceneOptions), svgOptions)`. It accepts `ManiaChart`, not a
`Beatmap | ManiaChart | RenderScene` union. Ordinary callers retain a `Beatmap` and pass its
normalized `chart`; advanced callers choose the explicit scene and serializer stages.

SVG-only metadata remains in `SerializeSvgOptions` and never participates in scene geometry. The
old `RenderOptions` and `RenderSvgOptions` names are removed in favor of `RenderSceneOptions` and
`SerializeSvgOptions`.

### Stateful viewport and future document architecture

The Inspector viewport remains an application runtime controller. It owns playhead state, buffer
reuse, refresh thresholds, viewport resize, and instrumentation, while consuming the same core
projection helpers for coordinates.

`projectTime` returns scene-local SVG Y. Dynamic viewport conversion must account for the moving
group transform before using the inverse helper:

```ts
const translateY = judgmentY - projectTime(scene.projection, playheadMs)
const sourceMs = unprojectTime(scene.projection, viewportY - translateY)
```

Overlay endpoints are projected independently and normalized with `min`/`max`; callers do not
assume a direction. Viewport translation remains an application concern but never recomputes a
`time delta * pixels-per-millisecond` mapping.

The Inspector's compact annotation timeline is not a `RenderScene` consumer: it owns a separate
zoomed timeline view model and may retain its own time-to-track mapping. This goal's canonical
projection rule covers RenderScene geometry and every falling-note scene consumer, not every
time-based visualization in the application.

Future full-chart publishing composes scenes above the current boundary:

```text
ManiaChart
   +-> createRenderScene(range) -> RenderScene -> Inspector / serializeSvg
   |
   +-> future createRenderDocument
          -> partition into half-open ranges
          -> create one RenderScene per panel
          -> place panels onto pages
          -> future serializeSvgPages

future osu! source adapter
   -> normalized timing/SV scroll timeline
   -> generic time-distance projection
   -> createRenderScene
```

Neither future branch changes what one `RenderScene` means.

## Required, optional, and default behavior

| Input | Contract |
| --- | --- |
| `osuSource` for `parseBeatmap` | Required |
| `ParseBeatmapOptions` | Optional |
| `filename`, `audio` | Optional |
| `Beatmap` as the ordinary caller's primary object | Required after parsing |
| `ManiaChart` for `renderSvg` or `createRenderScene` | Required |
| `RenderSceneOptions` | Required |
| `range.startMs`, `range.endMs` | Required together; finite; `endMs > startMs` |
| `pixelsPerSecond` | Optional; defaults to linear `240 px/s`; finite and positive when supplied |
| `playfield` | Optional; defaults to `widthPx: 640` |
| `widthPx` versus `laneWidthPx` | Exactly one when `playfield` is supplied |
| `timeDirection` | Optional; defaults to `bottom-to-top` |
| `theme` and metric overrides | Optional; current renderer values are the defaults |
| SVG `title` | Optional; serializer concern only |

Invalid range, scale, playfield, or resolved-metric relationships throw `RangeError` from
`createRenderScene` before glyph generation or serialization. Runtime validation also rejects a
plain JavaScript object that supplies both playfield width choices even though TypeScript already
makes that state unrepresentable.

## Non-goals

This immediate goal does not implement:

- automatic note-density or readable-scale resolution;
- `maxWidth`/`maxHeight` constraint solving;
- horizontal multi-playfield flow, pagination, or multiple SVG return values;
- osu!stable or osu!lazer scroll-speed adapters;
- normalized TimingPoints/SV or piecewise distance integration;
- PNG, Canvas, `sharp`, `resvg`, or another raster backend;
- a package-level viewport/playback controller;
- a `flow | viewport | unbounded` renderer option union;
- structured planner diagnostics or a render-document result wrapper;
- palette, font, skin asset, or plugin-style theme systems.

These are deferred layers, not rejected product directions. A later accepted decision must define
their real consumer, lifecycle, fidelity, and return-count contract before implementation.

## Boundary formulas

Scene membership and clipping are fixed as:

```ts
const tapIncluded = note.startMs >= range.startMs && note.startMs < range.endMs
const longIncluded = note.endMs > range.startMs && note.startMs < range.endMs

const visibleStartMs = Math.max(note.startMs, range.startMs)
const visibleEndMs = Math.min(note.endMs, range.endMs)
const continuesBefore = note.kind === "long" && note.startMs < range.startMs
const continuesAfter = note.kind === "long" && note.endMs > range.endMs
```

A long note ending exactly at `range.endMs` is rendered in the left scene with
`continuesAfter: false` and is absent from the adjacent right scene. A long note starting exactly at
`range.endMs` is absent from the left scene and eligible for the right scene.

## Execution status

Only `not-started`, `in-progress`, `blocked`, and `complete` are valid phase states. A phase becomes
complete only after every acceptance item has named evidence below.

| Phase | Status | Completed | Evidence |
| --- | --- | --- | --- |
| 0 — Goal specification | complete | 2026-09-03 | Decisions, boundary formulas, three initial reviews, and independent Amendment 1 review |
| 1 — Model, time, boundaries | complete | 2026-09-03 | 235 tests; package and Inspector type checks; corpus smoke |
| 2 — Canonical projection | complete | 2026-09-03 | 252 tests; dual-direction core and Inspector integration; independent review |
| 3 — Resolved geometry | complete | 2026-09-03 | 263 tests; exact sizing/precision regressions; type/runtime XOR; independent review |
| 4 — Public render contract | complete | 2026-09-03 | 266 tests; package gate; declaration/package audit; two independent reviews |

Phase 0 is frozen. Implementation may add evidence and clarify prose without changing the decided
contract. Any contract change requires an explicit amendment with rationale and another Phase 0
review before dependent implementation proceeds.

### Amendment 1 — Scene precision (2026-09-03)

`RenderScene` preserves resolved numeric precision. Geometry is not independently rounded while
building the scene; a backend such as the SVG serializer may format numbers only at its encoding
boundary, without changing finite/non-zero geometry into non-finite/zero output.

Rationale: for arbitrary key counts, independently rounding both the authoritative complete width
and each equal lane width cannot also preserve the fixed sizing formulas exactly. Mixed precision
would additionally make high-precision theme metrics disagree with the geometry they produced.
Keeping the visual IR precise preserves projection, equal-lane, and sizing invariants while leaving
compact textual formatting to each serializer.

Review requirement: Phase 3 cannot be accepted until tests show both playfield-size branches close
under the fixed formulas and high-precision resolved metrics remain observable in note geometry.

Review evidence: an independent Phase 0 review accepted the amendment after checking its numeric
policy against the frozen sizing formulas, projection invariants, resolved scene contract, and
implementation. A repeating-division 7K regression with fractional metrics records the identified
IEEE-754 boundary explicitly.

## Phased execution and acceptance

### Phase 0 — Freeze this goal specification

Acceptance:

- the document identifies the primary model and both public usage paths;
- immediate architecture, future seams, required inputs, defaults, and non-goals are explicit;
- the decision is consistent with ADR 0001 and repository architecture rules;
- no implementation capability is claimed before it exists.

### Phase 1 — Primary model and source-time vocabulary

Work:

- replace `createBeatmap`/`BeatmapInput` with `parseBeatmap`/`ParseBeatmapOptions`;
- migrate package public source-time fields and SVG data attributes to `*Ms`;
- export `TimeRange` and migrate first-party runtime ranges without removing persisted `V1` names;
- add the normalized `ManiaChart.range` complete-chart convenience;
- make render range required and update every package, archive parser, and first-party caller;
- apply the boundary formulas above in the same phase as the half-open public contract.

Acceptance:

- the README golden path starts with `parseBeatmap(osuSource)` and holds a `Beatmap`;
- public API tests contain `parseBeatmap` and no `createBeatmap` runtime export;
- a fixture with taps and crossing long notes preserves exact source milliseconds from parser to
  chart, scene, and SVG attributes;
- checked `@ts-expect-error` cases reject a render call without a range, while runtime JavaScript
  shapes without a valid range throw `RangeError`;
- tap and long-note membership matches every formula in “Boundary formulas,” including both shared
  endpoints across adjacent ranges;
- `parseOsz` and `iterateOsz` still produce equivalent connected `Beatmap` objects;
- package and Inspector type checks pass.

Evidence (accepted 2026-09-03):

- code: `types.ts`, `parser.ts`, `mania.ts`, `beatmap.ts`, `osz.ts`, `render-scene.ts`, `svg.ts`,
  and migrated Inspector/script consumers;
- runtime: `public-api.test.ts`, `beatmap.test.ts`, `mania.test.ts`,
  `render-boundaries.test.ts`, `render.test.ts`, and archive tests;
- type contract: `test/type-contracts.ts` verifies required options and both range endpoints;
- verification: all 33 Vitest files / 235 tests, package `tsc`, Inspector `vue-tsc`, Biome on changed
  source areas, package build, corpus-validator smoke, and `git diff --check` passed.

### Phase 2 — Canonical projection

Work:

- implement the serializable linear projection plus `projectTime` and `unprojectTime`;
- make scene note and long-note geometry consume the projection;
- migrate Inspector note placement, overlay range geometry, pointer inversion, and playhead
  translation to shared projection helpers without moving controller lifecycle into the package.

Acceptance:

- start, midpoint, and end projection tests pass for both directions and non-zero/negative ranges;
- forward/inverse round trips have absolute error at most `1e-9`;
- invalid or out-of-domain forward/inverse inputs throw `RangeError`;
- direction tests share one projection implementation;
- crossing long notes are clipped in time before projection;
- the old minimum-height behavior is absent and short-range endpoint distance equals
  `contentHeightPx`;
- `viewportYToSourceTime`, `BufferedSceneController.noteGroupTransform`, and annotation overlay
  geometry call `projectTime`/`unprojectTime`; viewport translation contains no duplicate linear
  time-to-Y formula;
- pointer and overlay round trips pass with non-zero group translation.

Evidence (accepted 2026-09-03):

- core: `projection.ts` owns closed-domain forward/inverse math; `render-scene.ts` clips long notes
  before projection and exposes `scene.projection` as the only range/direction/scale source;
- integration: `buffered-scene.ts`, `FallingNoteViewport.vue`, and `AnnotateWorkspace.vue` consume
  the helpers for moving-group, pointer, scrub, and overlay coordinates;
- runtime: `projection.test.ts` and `buffered-scene.test.ts` cover both directions, negative and
  non-zero ranges, `1e-9` round trips, short ranges, translated pointers, overlays, and large-time
  inclusive refresh-boundary floating error;
- verification: all 34 Vitest files / 252 tests, package `tsc`, Inspector `vue-tsc`, Biome, scoped
  stale-formula search, and independent correctness review passed.

### Phase 3 — Resolved geometry

Work:

- introduce playfield width XOR types and resolved theme metrics;
- move lane gap, note height, inset, radius, and padding out of renderer literals;
- validate resolved geometric relationships.

Acceptance:

- TypeScript prevents simultaneous `widthPx` and `laneWidthPx`, and runtime validation rejects the
  same plain-JavaScript shape;
- padding changes lane origin and scene size; gap changes lane X; height changes tap geometry;
  inset changes note X/width; radius changes glyph radius;
- a lane width that cannot contain the configured note inset is rejected before serialization.

Evidence (accepted 2026-09-03):

- contract: `PlayfieldSize` makes complete width and lane width mutually exclusive;
  `RenderThemeInput` groups partial metric overrides while `RenderScene.metrics` exposes the fully
  resolved values;
- geometry: both sizing branches close under the fixed formulas, all four padding sides and every
  metric affect their documented geometry, and the scene preserves resolved numeric precision per
  Amendment 1;
- validation: compile-time cases reject ambiguous sizing, runtime cases reject both/neither sizing
  fields and invalid scalars, and resolved lanes must be wider than twice the note inset;
- verification: all 34 Vitest files / 263 tests, package `tsc`, Inspector `vue-tsc`, Biome,
  `git diff --check`, a repeating-division 7K precision regression, and independent Phase 3 review
  passed.

### Phase 4 — Public render and serializer contract

Work:

- keep `renderSvg(ManiaChart, options, svgOptions?)` as the bounded convenience operation;
- keep `createRenderScene(ManiaChart, options)` as the explicit primitive;
- separate `SerializeSvgOptions` from scene options;
- expose resolved size, projection, metrics, and lane geometry on `RenderScene`;
- update root/package documentation, benchmarks, corpus validation, and compatibility notes.

Acceptance:

- `renderSvg(chart, options, svgOptions)` is byte-identical to the explicit scene/serializer path;
- checked `@ts-expect-error` cases prove SVG metadata cannot be supplied as scene geometry options
  and scene geometry cannot be supplied as serializer options;
- examples never imply an unbounded zero-option render;
- Inspector static and dynamic rendering consume `RenderTimeProjection`, verified by integration
  tests rather than type checking alone;
- the root runtime API snapshot is intentional and a Changeset describes the breaking migration.

Evidence (accepted 2026-09-03):

- API: `RenderScene.size` is the only resolved scene-size field; `SerializeSvgOptions` is separate,
  and three-argument `renderSvg` is byte-identical to explicit scene creation and serialization;
- contracts: checked negative type cases reject missing ranges, mixed scene/SVG concerns, ambiguous
  playfield sizing, all removed option names, and all removed top-level scene fields;
- integration: the Inspector static preview adapter and dynamic buffered controller both exercise
  bottom-to-top scenes through the canonical projection, including pointer, overlay, translation,
  and buffer-boundary behavior;
- edge behavior: derived scene heights reject overflow/underflow before geometry generation, while
  SVG encoding preserves valid sub-millipixel dimensions instead of collapsing them to zero;
- release: both READMEs document the minimal and advanced paths, every default, projection helpers,
  and deferred capabilities; the minor Changeset records the breaking migration;
- verification: all 35 Vitest files / 266 tests, full workspace type checks and builds, Biome,
  package dry-run, corpus and pattern-map smoke tests, generated declaration/runtime-export audits,
  `git diff --check`, and independent API plus DX reviews passed.

## Final verification

The goal is complete only when:

- every phase acceptance condition is represented by code, type, integration, or documentation
  evidence;
- `pnpm check` passes, including formatting, type checks, tests, builds, package contents, and smoke
  tests;
- tests cover public API shape, half-open boundaries, projection round trips, both directions,
  clipped long notes, playfield XOR, resolved metric validation, and primary/advanced equivalence;
- generated package declarations contain no stale public `createBeatmap`, `BeatmapInput`,
  `RenderOptions`, `RenderSvgOptions`, `RenderScene.timeRange`, or ambiguous public source-time
  field; scoped source search allows old names only in this migration ADR, Changeset, and checked
  negative type-contract assertions, and the duplicate-formula audit is limited to
  RenderScene-based falling-note consumers;
- the implementation remains DOM-free and performs no implicit file or network access.

Final evidence: the complete root `pnpm check` pipeline passed with the bundled pnpm 11.19.0,
including formatting, recursive type checks, 266 tests, both builds, package dry-run, and both smoke
test suites. The generated package contains only its declared files, exposes the intentional 11
runtime functions, and has no stale public declarations.

## Consequences

This is a deliberate pre-release breaking change. It shortens the ordinary path while making
advanced stages more explicit. Requiring a range removes a convenient but unsafe whole-chart
default. Canonical projection adds a small public domain concept, but it eliminates coordinate
drift and creates the correct seam for later non-linear scroll timelines.

Automatic layout and osu! fidelity work will begin from observable, bounded scenes rather than
forcing those policies into the current renderer. A future document planner may return resolved
layout and diagnostics without changing the strict scene API.
