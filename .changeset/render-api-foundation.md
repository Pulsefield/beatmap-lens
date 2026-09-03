---
"beatmap-lens": minor
---

Replace the pre-release render foundation with one Beatmap-centric, explicitly bounded API.
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
