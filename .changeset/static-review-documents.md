---
"beatmap-lens": minor
---

Add fixed-size static review documents with automatic horizontal panels, same-size SVG pages,
global linear fitting, and explicit row-aware readability projections. Review panels default to a
12px horizontal gap and an attached left-side source-time axis, with configurable layout, scale,
axis, and serialization options exposed through the new document APIs and shared render defaults.

`RenderTimeProjection` is now a linear/piecewise union, so code typed against the union must narrow
on `projection.type` before reading linear-only `pixelsPerSecond`.
