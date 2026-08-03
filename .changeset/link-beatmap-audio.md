---
"beatmap-lens": minor
---

Add `Beatmap` and `BeatmapSet` runtime models with optional shared audio references, direct audio
connection helpers, and bounded asynchronous in-memory `.osz` loading. `parseOsz` returns a promise,
while `iterateOsz` yields complete linked beatmaps with a configurable inflation budget and
concurrency throttle. Existing parser, chart, and render APIs are unchanged.
