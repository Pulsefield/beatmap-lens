# beatmap-lens

Parse, normalize, and render 4K `osu!mania` beatmaps from TypeScript.

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

The package is ESM-only, DOM-free, and performs no implicit file or network reads. It currently
supports a normalized 4K mania target with normal notes, long notes, bounded render scenes, and SVG
serialization.

Semantic chart-quality findings and synchronized audio review are project direction, not current
package features. See the [repository](https://github.com/Pulsefield/beatmap-lens) for the status and
architecture.
