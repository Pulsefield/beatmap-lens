# beatmap-lens

## 0.2.0

### Minor Changes

- 5c08561: Add a lightweight osu!lazer mania adapter that converts scroll speed and an effective landscape
  gameplay viewport into the renderer's linear pixels-per-second scale.
- 7ec4aa7: Add fixed-size static review documents with automatic horizontal panels, same-size SVG pages,
  global linear fitting, and explicit row-aware readability projections. Review panels default to a
  12px horizontal gap and an attached left-side source-time axis, with configurable layout, scale,
  axis, and serialization options exposed through the new document APIs and shared render defaults.

  `RenderTimeProjection` is now a linear/piecewise union, so code typed against the union must narrow
  on `projection.type` before reading linear-only `pixelsPerSecond`.

## 0.1.0

### Minor Changes

- 8f1b213: Tighten the pre-release API around the 4K parse, normalize, scene, and SVG path. This removes raw
  parser helper exports and unused options; callers with an existing scene must use
  `serializeSvg(scene)` instead of `renderSvg(scene)`.
- 58a6dc9: Detect 4K-10K `osu!mania` key counts from `CircleSize` and carry them through normalization,
  render scenes, SVG output, and corpus validation. Render scenes now use the key-count-neutral
  `mania` kind and expose `keyCount` directly.
- b136208: Add `Beatmap` and `BeatmapSet` runtime models with optional shared audio references, direct audio
  connection helpers, and bounded asynchronous in-memory `.osz` loading. `parseOsz` returns a promise,
  while `iterateOsz` yields complete linked beatmaps with a configurable inflation budget and
  concurrency throttle. Existing parser, chart, and render APIs are unchanged.
- 69f337e: Replace the pre-release render foundation with one Beatmap-centric, explicitly bounded API.
  `parseBeatmap` and `ParseBeatmapOptions` replace `createBeatmap` and `BeatmapInput`; public source
  times now use `*Ms`, and `ManiaChart.range` exposes an intentional complete-chart range.

  Require `RenderSceneOptions` with a half-open `range`, move range, direction, and scale into the
  scene's canonical projection, group resolved geometry under `metrics` and `size`, and replace flat
  width and theme fields with the exclusive `playfield.widthPx`/`playfield.laneWidthPx` choice and
  nested partial `theme.metrics` overrides. The default time direction is bottom-to-top.

  Export `projectTime` and `unprojectTime` as the canonical forward and inverse scene-coordinate
  helpers, replacing duplicated renderer and Inspector projection formulas.

  Split SVG serialization from scene construction: `renderSvg(chart, sceneOptions, svgOptions?)` is
  the convenience path, while `createRenderScene` plus `serializeSvg(scene, svgOptions?)` is the
  advanced path. SVG note attributes are now `data-start-ms` and `data-end-ms`, with explicit
  `data-continues-before` and `data-continues-after` boundary markers.

- 85ceed7: Render scene time from bottom to top by default so static SVG output matches the osu!mania reading
  direction. Pass `timeDirection: "top-to-bottom"` to preserve the previous orientation.
