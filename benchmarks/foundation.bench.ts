import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import {
  createRenderScene,
  type ManiaChart,
  parseOsu,
  renderSvg,
  serializeSvg,
  toManiaChart,
} from "../packages/beatmap-lens/src/index.js";

const source = readFileSync(
  new URL("../fixtures/beatmaps/foundation-4k.osu", import.meta.url),
  "utf8",
);
const document = parseOsu(source);
const chart = toManiaChart(document);
const renderOptions = {
  range: { startMs: 0, endMs: 8_000 },
  playfield: { widthPx: 640 },
  pixelsPerSecond: 120,
};
const realScaleNoteCount = 40_841;
const realScaleChart: ManiaChart = {
  keyCount: 7,
  metadata: {},
  notes: Array.from({ length: realScaleNoteCount }, (_, index) => ({
    id: `note-${index}`,
    kind: "normal" as const,
    sourceKind: "normal" as const,
    column: index % 7,
    startMs: index * 10,
    endMs: index * 10,
    sourceLine: index + 1,
    x: 64,
    hitSound: 0,
  })),
  range: { startMs: 0, endMs: realScaleNoteCount * 10 },
  diagnostics: [],
};
const realScaleScene = createRenderScene(realScaleChart, {
  range: realScaleChart.range,
  playfield: { widthPx: 640 },
  pixelsPerSecond: 45,
});

describe("foundation pipeline", () => {
  bench("parse a beatmap", () => {
    parseOsu(source);
  });

  bench("normalize a 4K chart", () => {
    toManiaChart(document);
  });

  bench("produce a render scene", () => {
    createRenderScene(chart, renderOptions);
  });

  bench("serialize SVG", () => {
    renderSvg(chart, renderOptions);
  });

  bench("serialize a 40K-note full-chart SVG", () => {
    serializeSvg(realScaleScene);
  });
});
