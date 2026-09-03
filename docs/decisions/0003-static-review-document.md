# Static review document

- Status: Accepted
- Date: 2026-09-03

## Goal

Add a fixed-size, multi-panel, multi-page static review document above the existing single-scene
renderer. The document planner owns range partitioning, page packing, readable time spacing, and a
panel-local source-time axis. `RenderScene` remains one bounded, contiguous, half-open source-time
range, one playfield, and one canonical projection.

The target paths are explicit about their return counts:

```text
Primary
parseBeatmap -> Beatmap.chart -> renderSvgPages -> SerializedSvgPage[]

Advanced
ManiaChart -> createRenderDocument -> RenderDocument -> serializeSvgPages
```

`renderSvg` continues to return exactly one SVG string. It never gains pagination flags or a
`string | string[]` return type.

## Problem

Three static-review needs do not belong to `RenderSceneOptions`:

1. A fixed page width controls how many playfield panels fit horizontally; it does not decide how
   many distinct note rows one panel may contain.
2. A fixed output size requires range partitioning and pagination while keeping every output page
   exactly the same size.
3. Every panel needs a narrow, true source-time coordinate rail. In a non-linear readability mode,
   its labels remain real source times and compression must be visible.

These needs expose four independent constraints:

```text
page width                  -> columns per page
panel.maxNoteRows           -> cognitive row capacity
linear/fit pixelsPerSecond  -> faithful global time scale
row-aware gap limits        -> explicit non-linear readability projection
```

Putting `maxWidth`, `adaptive`, `paginate`, `columns`, or `timeAxis` onto a single-scene operation
would erase the boundary accepted in ADR 0002 and make return shape and projection semantics depend
on loosely related flags.

## Target architecture

```text
ManiaChart
    |
    v
createRenderDocument
    |
    v
RenderDocument
    +-- Page 0 (fixed SizePx)
    |     +-- Panel 0 -> RenderScene + RenderTimeAxis
    |     +-- Panel 1 -> RenderScene + RenderTimeAxis
    |     `-- Panel 2 -> RenderScene + RenderTimeAxis
    `-- Page 1 (same SizePx)
          `-- ...
    |
    v
serializeSvgPages
    |
    v
SerializedSvgPage[]
```

The planner resolves one policy object, partitions the requested range into contiguous half-open
panel ranges, creates one canonical projection and scene for each range, packs panels from left to
right, and overflows onto another same-size page. The serializer consumes the resolved document;
it never repeats planner math.

## Public operations

```ts
createRenderDocument(
  chart: ManiaChart,
  options: RenderDocumentOptions,
): RenderDocument

serializeSvgPages(
  document: RenderDocument,
  options?: SerializeSvgPagesOptions,
): readonly SerializedSvgPage[]

renderSvgPages(
  chart: ManiaChart,
  options: RenderDocumentOptions,
  svgOptions?: SerializeSvgPagesOptions,
): readonly SerializedSvgPage[]
```

The existing operations remain unchanged:

```ts
createRenderScene(chart, options): RenderScene
serializeSvg(scene, options?): string
renderSvg(chart, sceneOptions, svgOptions?): string
```

## Input contract

```ts
export interface SizePx {
  readonly widthPx: number
  readonly heightPx: number
}

export type RenderPaddingInput = number | Partial<RenderPadding>

export interface RenderDocumentOptions {
  /** Required half-open source-time range [startMs, endMs). */
  readonly range: TimeRange

  readonly page?: {
    /** Exact size of every serialized page. */
    readonly size?: SizePx
    readonly paddingPx?: RenderPaddingInput
    readonly gapPx?: number
    /** `auto` derives the maximum count without shrinking the playfield. */
    readonly columns?: "auto" | number
  }

  readonly panel?: {
    readonly playfield?: PlayfieldSize
    /** Unique in-range note start times; a chord is one row. */
    readonly maxNoteRows?: number | "unbounded"
    readonly maxSourceDurationMs?: number
  }

  readonly scale?: RenderDocumentScaleInput
  readonly timeDirection?: RenderTimeDirection
  readonly timeAxis?: false | RenderTimeAxisInput
  readonly theme?: RenderThemeInput
}

export type RenderDocumentScaleInput =
  | {
      readonly type: "linear"
      readonly pixelsPerSecond?: number
    }
  | {
      readonly type: "fit"
      readonly preferredPixelsPerSecond?: number
      readonly minPixelsPerSecond?: number
    }
  | {
      readonly type: "row-aware"
      readonly basePixelsPerSecond?: number
      readonly minRowGapPx?: number
      readonly maxEmptyGapPx?: number
    }

export interface RenderTimeAxisInput {
  readonly side?: "left" | "right"
  readonly widthPx?: number
  readonly labels?: "bounds" | "major"
  readonly tickStepMs?: number | "auto"
  /** Defaults to true; linear projections simply have no compressed ranges to mark. */
  readonly showCompressionMarks?: boolean
}
```

The remaining public result and serialization contracts are:

```ts
export interface SerializeSvgPagesOptions {
  /** Base title; every page appends ` - page N of M`. */
  readonly title?: string
}

export interface ResolvedPlayfieldSize {
  readonly widthPx: number
  readonly laneWidthPx: number
}

export type ResolvedRenderDocumentScale =
  | {
      readonly type: "linear"
      readonly pixelsPerSecond: number
    }
  | {
      readonly type: "fit"
      readonly preferredPixelsPerSecond: number
      readonly minPixelsPerSecond: number
      readonly pixelsPerSecond: number
    }
  | {
      readonly type: "row-aware"
      readonly basePixelsPerSecond: number
      readonly minRowGapPx: number
      readonly maxEmptyGapPx: number
    }

export interface ResolvedRenderTimeAxisOptions {
  readonly side: "left" | "right"
  readonly widthPx: number
  /** Fixed document-layout gap between the playfield and axis. */
  readonly gapPx: number
  readonly labels: "bounds" | "major"
  readonly tickStepMs: number | "auto"
  readonly showCompressionMarks: boolean
}

export interface ResolvedRenderDocumentOptions {
  readonly pageSize: SizePx
  readonly pagePaddingPx: RenderPadding
  readonly pageGapPx: number
  readonly columnsPerPage: number
  readonly panelPlayfield: ResolvedPlayfieldSize
  readonly panelWidthPx: number
  readonly panelContentHeightPx: number
  readonly maxNoteRows: number | "unbounded"
  readonly maxSourceDurationMs: number
  readonly scale: ResolvedRenderDocumentScale
  readonly timeDirection: RenderTimeDirection
  readonly timeAxis: false | ResolvedRenderTimeAxisOptions
  readonly panelCount: number
  readonly pageCount: number
}

export interface RenderDiagnostic {
  readonly severity: "warning"
  readonly code: "fit-minimum-reached"
  readonly message: string
}

export interface RenderTimeAxisTick {
  readonly kind: "start" | "major" | "end"
  readonly timeMs: number
  /** Scene-local Y from the panel's canonical projection. */
  readonly y: number
  readonly label: string
}

export interface RenderTimeCompressionMark {
  readonly range: TimeRange
  /** Scene-local Y at the projected midpoint of `range`. */
  readonly y: number
}

export interface RenderTimeAxis {
  readonly side: "left" | "right"
  readonly widthPx: number
  readonly gapPx: number
  readonly labels: "bounds" | "major"
  /** Resolved positive step, including when the input was `auto`. */
  readonly tickStepMs: number
  readonly ticks: readonly RenderTimeAxisTick[]
  readonly compressionMarks: readonly RenderTimeCompressionMark[]
}
```

`timeAxis`, not `timeline`, names the static panel-local coordinate rail. The Inspector's full-song
interactive timeline remains separate application state.

## Defaults

Document defaults are distinct from single-scene defaults and are exported in this exact shape.
`document.resolved` remains the authoritative runtime result after chart- and page-dependent
resolution. The exported object and every nested object are frozen at runtime so inspection cannot
mutate later default behavior.

```ts
export const renderDefaults = {
  scene: {
    pixelsPerSecond: 240,
    playfield: { widthPx: 640 },
    timeDirection: "bottom-to-top",
    metrics: {
      paddingPx: { top: 24, right: 16, bottom: 24, left: 16 },
      laneGapPx: 4,
      noteHeightPx: 8,
      noteInsetPx: 5,
      noteRadiusPx: 2,
    },
  },
  document: {
    page: {
      size: { widthPx: 1600, heightPx: 900 },
      paddingPx: { top: 24, right: 24, bottom: 24, left: 24 },
      gapPx: 12,
      columns: "auto",
    },
    panel: {
      playfield: { laneWidthPx: 48 },
      maxNoteRows: 32,
      maxSourceDurationMs: 10_000,
    },
    scale: { type: "linear", pixelsPerSecond: 240 },
    fit: { preferredPixelsPerSecond: 240, minPixelsPerSecond: 140 },
    rowAware: { basePixelsPerSecond: 240, minRowGapPx: 12, maxEmptyGapPx: 72 },
    timeDirection: "bottom-to-top",
    timeAxis: {
      side: "left",
      widthPx: 32,
      gapPx: 0,
      labels: "major",
      tickStepMs: "auto",
      showCompressionMarks: true,
    },
  },
} as const
```

| Input | Default |
| --- | ---: |
| page size | `1600 x 900px` |
| page padding | `24px` on every side |
| panel gap | `12px` |
| panel playfield | `{ laneWidthPx: 48 }` |
| panel max note rows | `32` |
| panel max source duration | `10_000ms` |
| omitted scale | `{ type: "linear", pixelsPerSecond: 240 }` |
| fit preferred / minimum | `240 / 140px/s` |
| row-aware base / row gap / empty gap | `240px/s / 12px / 72px` |
| time direction | `bottom-to-top` |
| time axis | enabled, left, `32px`, major labels, auto ticks |
| internal playfield-to-axis gap | `0px` (attached) |
| last page alignment | start / left |

`RenderScene` keeps its existing `{ widthPx: 640 }`, `240px/s`, and metric defaults. Adding this
document operation must not alter single-scene geometry or SVG bytes.

## Resolved result

All defaults and constraint results are observable:

```ts
export interface RenderDocument {
  readonly kind: "mania-document"
  readonly range: TimeRange
  readonly pageSize: SizePx
  readonly resolved: ResolvedRenderDocumentOptions
  readonly pages: readonly RenderPage[]
  readonly diagnostics: readonly RenderDiagnostic[]
}

export interface RenderPage {
  /** Zero-based within the document. */
  readonly index: number
  readonly size: SizePx
  readonly range: TimeRange
  readonly panels: readonly RenderPanel[]
}

export interface RenderPanel {
  /** Zero-based within the document, not within the page. */
  readonly index: number
  readonly range: TimeRange
  readonly noteRowCount: number
  /** Actual occupied bounds in page-local coordinates. */
  readonly frame: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly scene: RenderScene
  readonly timeAxis?: RenderTimeAxis
}

export interface SerializedSvgPage {
  readonly index: number
  readonly count: number
  readonly range: TimeRange
  readonly size: SizePx
  readonly svg: string
}
```

`ResolvedRenderDocumentOptions` records page padding/gap/columns, panel sizing/limits, scale,
direction, time-axis settings, `panelCount`, and `pageCount`. A row-aware resolved scale names its
mode and parameters; a fit resolved scale records the single chosen `pixelsPerSecond`.

Diagnostics are structured warnings. The initial fit diagnostic reports that the minimum scale was
reached while pagination is still required. Constraint conflicts that prevent any panel from
fitting are programmer/input errors and throw `RangeError` rather than becoming diagnostics.

All numeric inputs are checked before planning. Range semantics match `createRenderScene`. Page
size, scale values, panel duration, axis width, and an explicit tick step must be finite and
positive. Padding and page gap must be finite and non-negative. Explicit columns and finite row
limits must be positive integers. Fit requires
`minPixelsPerSecond <= preferredPixelsPerSecond`. Row-aware gaps must be finite and positive and
must not exceed the resolved panel content-height capacity. Page padding must leave positive inner
width and height. Violations throw `RangeError`.

## Layout and partitioning

Page inner dimensions are:

```text
innerWidth  = page.width  - page.padding.left - page.padding.right
innerHeight = page.height - page.padding.top  - page.padding.bottom
```

One panel width is the resolved scene/playfield width plus the fixed `8px` axis gap and resolved
axis width when the axis is enabled. Automatic columns are:

```text
max(1, floor((innerWidth + pageGap) / (panelWidth + pageGap)))
```

If one panel does not fit, or an explicit positive-integer column count does not fit, planning
throws `RangeError`. It never shrinks lanes. Explicit columns may be lower than the maximum and
therefore deliberately produce more pages.

Panel content-height capacity subtracts the scene's resolved top/bottom padding from page inner
height. A linear panel's physical duration capacity is that height divided by the document-wide
pixels-per-second value. The next panel boundary is the earliest of:

- the document end;
- physical-height capacity;
- `panel.maxSourceDurationMs`;
- the `(maxNoteRows + 1)`th unique note start at or after the panel start.

`maxNoteRows` counts only unique `note.startMs` values in `[panel.startMs, panel.endMs)`. Notes at
the same time form one row; a crossing long-note continuation and long-note ends do not add rows.
Every boundary uses the existing half-open membership rules, so a tap at a boundary appears only in
the following panel and crossing long notes use `continuesBefore` / `continuesAfter`.

Panels pack chronologically left to right. A partial final page remains fixed-size and left-aligned.
Short `bottom-to-top` scenes are bottom-aligned to the page inner area so their source-start edges
line up; short `top-to-bottom` scenes are top-aligned. Scenes are never stretched and no source
time is invented to fill a slot.

## Scale modes

### Linear

Linear is the default faithful-time mode. Every panel and page uses exactly one requested or
default `pixelsPerSecond`. The planner may add panels and pages but must never lower the scale.

An `osuLazerManiaPixelsPerSecond` result is a hard linear input. The gameplay viewport passed to
that adapter remains distinct from the export page size.

### Fit

Fit remains linear and uses one global scale. Its result is uniquely defined by two ordered goals:

1. Plan at `minPixelsPerSecond` to find the smallest page count attainable within the allowed
   scale interval.
2. Choose the greatest value in `[minPixelsPerSecond, preferredPixelsPerSecond]` that preserves
   that page count.

If the preferred scale already produces that page count, it is retained. Otherwise a deterministic
64-iteration binary search finds the upper transition and chooses the greatest tested fitting
value. All final panels are replanned once at that one resolved value. Fit never selects per-panel
scales and never goes below the minimum. A `fit-minimum-reached` diagnostic is emitted only when
lowering from preferred to minimum reduces the page count, the final resolved value equals
`minPixelsPerSecond`, and that result still needs multiple pages. Equal minimum/preferred values and
pagination caused entirely by rows, duration, or explicit columns therefore emit no misleading
minimum warning.

### Row-aware

Row-aware is explicitly non-linear. Its canonical projection is piecewise-linear:

```ts
export interface PiecewiseLinearRenderTimeProjection {
  readonly type: "piecewise-linear"
  readonly range: TimeRange
  readonly direction: RenderTimeDirection
  readonly contentTopPx: number
  readonly contentHeightPx: number
  readonly basePixelsPerSecond: number
  readonly anchors: readonly {
    readonly timeMs: number
    readonly distancePx: number
  }[]
  readonly compressedRanges: readonly TimeRange[]
}

export type RenderTimeProjection =
  | LinearRenderTimeProjection
  | PiecewiseLinearRenderTimeProjection
```

For a valid piecewise projection,
`contentHeightPx === anchors.at(-1).distancePx === sum(resolved interval distances)`.

Projection anchors include panel boundaries, in-range note starts, and clipped long-note starts and
ends, deduplicated by exact source time. Both time and distance anchors are strictly increasing.

For each adjacent source interval, the fixed-range resolver performs these steps in order:

1. Baseline distance is `duration * basePixelsPerSecond / 1000`.
2. An interval covered by at least one active long note receives its baseline distance. An inactive
   interval receives `min(baselineDistance, maxEmptyGapPx)`.
3. Consecutive distinct note-start rows are processed in increasing time order. If their current
   cumulative anchor distance is below `minRowGapPx`, the entire deficit is added to the rightmost
   source interval ending at the later row. This deterministic expansion never subtracts distance.
4. After expansion, an interval is compressed exactly when its final distance is below baseline.
   Adjacent compressed intervals are merged when one's `endMs` exactly equals the next one's
   `startMs`; these maximal merged ranges become `compressedRanges`.

The row gap is an anchor-distance guarantee, not a guarantee between final glyph bounding boxes.
Chords share one anchor and do not add spacing.

Row-aware panels are planned greedily against the same content-height capacity. The document end,
row limit, and max-source-duration first define a hard candidate end. If its fixed-range projection
fits, it is accepted. Otherwise the first overflowing interval determines the maximum feasible
half-open prefix:

- if it ends at a note-start row, the prefix ending exactly at that source time is re-resolved; if
  it fits, that boundary is used and the row belongs to the next panel; if it still does not fit,
  resolution continues with the same interval's uncapped/capped rule below;
- if the interval uses uncapped baseline distance, the remaining capacity is converted back to an
  exact source-time cut at `basePixelsPerSecond`; this may split an active long note;
- if the interval is an inactive capped gap, the cut is the preceding anchor so the complete capped
  gap moves to the next panel.

A discrete row-spacing jump is allowed to leave unused height; the planner does not invent a point
whose re-resolved half-open projection would have different semantics. The positive gap validations
guarantee progress; an uncapped first interval is split when no later anchor fits. The resulting
range is re-resolved once and must fit before its scene is created. Row count and
max-source-duration remain hard limits. Each panel-local projection is resolved from that panel's
clipped events. Panel-local compression is intentional and observable; comparison of physical time
distance requires the axis and structural metadata.

`projectTime` and `unprojectTime` interpolate and invert the same anchor segment. They keep their
closed geometric domain and round-trip guarantees for both projection variants.

## Time axis

Each panel owns its axis because it owns a different source-time range. Axis tick Y coordinates are
produced by the same projection as notes.

- Boundary ticks are always present and labelled, even when an extremely short panel causes their
  labels to overlap.
- `labels: "bounds"` adds no intermediate labels.
- `labels: "major"` uses an explicit positive `tickStepMs`, or the smallest auto
  `1/2/5 x 10^n ms` step whose average projected distance is at least `48px`.
- Major ticks lie on an absolute source-time grid with origin `0ms`; only strict interior multiples
  of the resolved step are candidates.
- Intermediate labels whose projected positions are within `18px` of a boundary or a previously
  retained label are removed; boundary labels win.
- Labels use signed source time rounded symmetrically to the nearest `100ms`, with normal carry:
  `m:ss.S` below one hour and `h:mm:ss.S` at one hour or above.
- Bottom-to-top places `range.startMs` at the bottom; top-to-bottom places it at the top.
- Row-aware compression marks are derived from `projection.compressedRanges`; the serializer does
  not infer compression from geometry.

The SVG records `data-time-scale="linear"`, `"fit"`, or `"row-aware"` on each panel regardless of
axis visibility. When the axis and marks are enabled, every maximal compressed range produces one
low-contrast double slash. An explicit `timeAxis: false` or `showCompressionMarks: false` is
respected; structural projection metadata remains observable.

Axis labels use a `7px` monospace font inside the fixed-width axis. The serializer clips axis paint
to its frame and applies SVG `textLength`/`lengthAdjust="spacingAndGlyphs"` only when a deterministic
`0.6em` character-width estimate exceeds `widthPx - 4`. It never expands the axis or page.

## SVG composition

The page serializer creates one root `<svg>` per page and emits scene content as translated groups;
it never nests complete SVG strings or strips roots with a regular expression. Each panel has a
deterministic clip path.

Single-scene DOM IDs stay unchanged. Page SVG note IDs are scoped by document-global panel index,
for example `panel-0003-note-0001`; the original note identity is preserved in `data-note-id`.
Clip IDs and note IDs are unique within each page, use no random/global counters, and are stable
across repeated serialization.

## Constraint conflicts

| Condition | Result |
| --- | --- |
| Width allows only one panel | Use one column |
| One complete panel is too wide/high | `RangeError` |
| Explicit columns do not fit | `RangeError` |
| Linear scale needs more panels | Add panels/pages |
| Row limit is reached first | Break before the next distinct row |
| Fit reaches minimum and still paginates | Add pages and diagnostic |
| Final page has one panel | Keep fixed size and left alignment |
| Row-aware compresses empty time | Resolved mode and metadata expose it; marks do too unless explicitly disabled |

## Non-goals

This goal does not add:

- fields such as `paginate`, `columns`, `timeAxis`, or `adaptive` to `RenderSceneOptions`;
- `string | string[]` return shapes;
- beat- or measure-aligned breaks without normalized timing/SV data;
- osu!stable/lazer branches inside the generic renderer;
- PNG, Canvas, `sharp`, `resvg`, or an asynchronous format union;
- a skin/plugin system;
- the Inspector's stateful page viewer or its interactive full-song timeline;
- changes to the dynamic falling-note viewport controller.

Raster output and Inspector page navigation require concrete consumer work after this core contract
ships. Theme palette completion is also a separate goal; this document keeps the existing scene
paint defaults and adds only fixed low-contrast page/axis paint.

## Required invariants

- Every page has exactly the resolved page size.
- Panel ranges cover the requested range continuously, without overlap or holes.
- Every panel range is non-empty.
- Every tap appears in exactly one panel; long-note continuation states match overlap boundaries.
- A chord is never split and every panel respects `maxNoteRows`.
- Linear and fit modes use one document-wide scale.
- Every scene fits inside the page inner height.
- Piecewise anchors are strictly increasing in source time and distance and are invertible.
- Active long-note time is never compressed below baseline distance.
- Non-linear output is structurally identified, and is visibly marked unless the caller explicitly
  disables the axis or compression marks.
- Page SVG IDs and output order are deterministic.
- Existing single-scene geometry, APIs, and SVG bytes remain unchanged.

## Execution status

Only `not-started`, `in-progress`, `blocked`, and `complete` are valid states. A phase becomes
complete only when every acceptance item has named evidence.

| Phase | Status | Completed | Evidence |
| --- | --- | --- | --- |
| 0 — Freeze specification | complete | 2026-09-03 | Problem and architecture frozen; two independent review rounds resolved public-shape, row-aware, mark opt-out, fit-diagnostic, and tick-grid ambiguities |
| 1 — Linear fixed-size document | complete | 2026-09-03 | `render-document.test.ts`, `svg-pages.test.ts`, and unchanged single-scene render goldens cover fixed pages, packing, axes, IDs, and shortcut equivalence |
| 2 — Global fit | complete | 2026-09-03 | Fit tests cover the upper transition, preferred retention, point intervals, one global scale, and minimum diagnostics |
| 3 — Row-aware projection | complete | 2026-09-03 | Projection/document/SVG tests cover bidirectional inversion, dense rows, capped gaps, active LN splits, float boundaries, metadata, and marks |
| 4 — Documentation and release gate | complete | 2026-09-03 | READMEs and changeset updated; 327 tests, both type checks, Biome, both builds, package dry-run, corpus checks, and two independent implementation review rounds passed |

Phase 0 is frozen. Implementation may append evidence or clarify wording without changing the
decided contract. A contract change requires an explicit amendment and review before dependent
work continues.

## Phased execution and acceptance

### Phase 0 — Freeze specification

Acceptance:

- the problem and target document-over-scene architecture are explicit;
- public operations, inputs, resolved outputs, defaults, layout order, and return count are fixed;
- fit has a unique global optimization target;
- row-aware spacing explicitly preserves active long-note duration and has deterministic interval,
  row-deficit, compression-range, and capacity-overflow rules;
- non-goals preserve ADR 0002 and the DOM-free synchronous package boundary;
- an independent review checks boundary, projection, SVG-ID, and test risks.

### Phase 1 — Linear fixed-size document

Work:

- add public document/page/panel/axis/result types and exported document defaults;
- implement linear range partitioning, note-row limits, fixed page packing, and resolved options;
- create panel-local bounds/major time axes from the canonical linear projection;
- extract scene-group SVG serialization while preserving existing single-SVG bytes;
- add fixed-size page serialization, deterministic clip/DOM IDs, and the `renderSvgPages` shortcut.

Acceptance:

- page, column, row, duration, final-page, and vertical-alignment fixtures match this specification;
- panel ranges are contiguous and note/LN boundary behavior reuses the single-scene contract;
- all page roots share exact dimensions and contain no nested `<svg>`;
- page-local IDs are unique and repeated serialization is byte-identical;
- `renderSvgPages(chart, options)` equals
  `serializeSvgPages(createRenderDocument(chart, options))`;
- existing `renderSvg` golden output remains byte-identical.

### Phase 2 — Global fit

Work:

- implement the two-goal document-wide fit solver;
- expose its one resolved pixels-per-second value and minimum diagnostic;
- replan final panels at exactly that value.

Acceptance:

- every fit panel uses the same scale within the configured interval;
- preferred scale is retained when it already attains the minimum page count;
- a boundary fixture proves fit lowers scale only enough to keep the minimum page count;
- row/duration-dominated layouts do not lower scale unnecessarily;
- minimum-scale pagination is returned with the named diagnostic.

### Phase 3 — Row-aware projection

Work:

- add piecewise-linear forward/inverse projection;
- add the internal scene-from-projection path so glyph creation remains canonical;
- implement greedy row-aware partitioning, minimum row gaps, empty-gap compression, and active-LN
  preservation;
- add projection-derived compression marks and row-aware SVG metadata.

Acceptance:

- both directions round-trip endpoints, anchors, and segment interiors within `1e-9`;
- dense distinct rows expand, chords do not, and empty inactive gaps compress;
- long-note-only and overlapping-long-note intervals keep at least baseline distance;
- a long note may cross panel/page boundaries with correct continuation state;
- every row-aware scene stays within content-height capacity and all ranges advance continuously;
- every compressed range produces observable metadata and, unless explicitly disabled, an axis
  mark.

### Phase 4 — Documentation and release gate

Work:

- document primary/advanced page APIs, all three scale modes, defaults, and lazer composition;
- update the repository architecture/scope statements and add a package changeset;
- run source formatting, type checks, complete tests, builds, package dry-run, and an independent
  correctness review.

Acceptance:

- public API and type-contract tests enumerate the intended surface;
- package README examples compile against declarations;
- the full repository gate passes;
- ADR execution evidence names exact tests and review outcomes.

Evidence recorded on 2026-09-03:

- `vitest run --reporter=dot`: 40 files and 327 tests passed;
- package `tsc --noEmit` and Inspector `vue-tsc --noEmit`: passed;
- `biome ci .`: 116 files checked without findings;
- package `tsdown` build and Inspector `vite build`: passed;
- `npm pack --dry-run`: six expected published files, including declarations and source map;
- corpus validator and pattern-category-map checks: passed;
- two independent implementation review rounds checked partitioning, fit boundaries, row-aware
  floating-point cuts, projection complexity, SVG clipping/IDs, public defaults, and regression
  coverage. The confirmed floating-point, mutable-default, and projection-complexity findings were
  fixed and regression-tested; the final review reported no unresolved correctness finding.
