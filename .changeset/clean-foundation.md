---
"beatmap-lens": minor
---

Tighten the pre-release API around the 4K parse, normalize, scene, and SVG path. This removes raw
parser helper exports and unused options; callers with an existing scene must use
`serializeSvg(scene)` instead of `renderSvg(scene)`.
