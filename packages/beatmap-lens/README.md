# beatmap-lens

Parse, normalize, and render `osu!mania` beatmaps from TypeScript.

The package is not published to npm yet, and its API is not stable. The current data path is:

```text
parseOsu -> toManiaChart -> createRenderScene -> renderSvg
```

```ts
import { parseOsu, renderSvg, toManiaChart } from "beatmap-lens";

const document = parseOsu(osuSource);
const chart = toManiaChart(document);
const svg = renderSvg(chart, {
  startTime: 0,
  endTime: 15_000,
  width: 640,
  pixelsPerSecond: 240,
});
```

The core package is ESM-only, DOM-free, and performs no implicit file or network reads. The first supported normalized target is 4K mania. See the source repository for the full status, architecture, development commands, and roadmap.
