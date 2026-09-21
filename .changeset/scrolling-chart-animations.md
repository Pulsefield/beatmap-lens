---
"beatmap-lens": minor
---

Add animated WebP and GIF exports through `renderAnimation` from `beatmap-lens/node`, with bounded playback ranges, viewport sizing, pixel ratio, scroll speed, frame rate, loop and encoder controls. Sharp is included for ready-to-use Node.js encoding.

Expose DOM-free `createRenderAnimation`, `createAnimationScene` and lazy `iterateAnimationFrames` APIs in the core package, plus `encodeAnimation` for custom synchronous or asynchronous scene pipelines. Preserve timing through cumulative delay rounding and coalescing of frames too short for reliable playback.
