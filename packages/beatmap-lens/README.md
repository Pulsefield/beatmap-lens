# beatmap-lens

A pre-release TypeScript toolkit for 4K-10K `osu!mania` beatmaps.

The package is not published, and its API can still change.

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
const options = {
  startTime: 0,
  endTime: 15_000,
  width: 640,
  pixelsPerSecond: 240,
};

const scene = createRenderScene(chart, options);
const svg = renderSvg(chart, options);
const sameSvg = serializeSvg(scene);
```

The package is ESM-only, DOM-free, and performs no implicit file or network reads. It detects the
key count of valid `osu!mania` files from `[Difficulty] CircleSize` and supports 4K-10K normal
notes, long notes, bounded render scenes, and SVG serialization.

The package boundary is every integer key count from 4K through 10K. The normalized chart,
diagnostics, render scene, analysis, and serialization stages share one key-count-aware pipeline
rather than separate per-key-count APIs. The first-party Inspector prioritizes 4K-7K at the app
layer; that narrower delivery priority does not reduce the package range.

Semantic chart-quality findings and synchronized audio review are project direction, not current
package features. See the [repository](https://github.com/Pulsefield/beatmap-lens) for the status and
architecture.
