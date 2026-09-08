# Render API foundation goal

- Status: Accepted
- Date: 2026-09-03

This is the accepted design record. See the [package README](../../packages/beatmap-lens/README.md)
for the current API and usage.

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

`connectBeatmapAudio` remains available when audio is associated later. At the time of this decision, the package was
unpublished and versioned `0.0.0`, so the change did not retain deprecated `createBeatmap` or
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

## Amendment 1 — Scene precision (2026-09-03)

`RenderScene` preserves resolved numeric precision. Geometry is not independently rounded while
building the scene; a backend such as the SVG serializer may format numbers only at its encoding
boundary, without changing finite/non-zero geometry into non-finite/zero output.

Rationale: for arbitrary key counts, independently rounding both the authoritative complete width
and each equal lane width cannot also preserve the fixed sizing formulas exactly. Mixed precision
would additionally make high-precision theme metrics disagree with the geometry they produced.
Keeping the visual IR precise preserves projection, equal-lane, and sizing invariants while leaving
compact textual formatting to each serializer.

## Consequences

This is a deliberate pre-release breaking change. It shortens the ordinary path while making
advanced stages more explicit. Requiring a range removes a convenient but unsafe whole-chart
default. Canonical projection adds a small public domain concept, but it eliminates coordinate
drift and creates the correct seam for later non-linear scroll timelines.

Automatic layout and osu! fidelity work will begin from observable, bounded scenes rather than
forcing those policies into the current renderer. A future document planner may return resolved
layout and diagnostics without changing the strict scene API.
