import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import {
  createRenderScene,
  parseOsu,
  renderSvg,
  toManiaChart,
} from "../packages/beatmap-lens/src/index.js";

const source = readFileSync(
  new URL("../fixtures/beatmaps/foundation-4k.osu", import.meta.url),
  "utf8",
);
const document = parseOsu(source);
const chart = toManiaChart(document);
const renderOptions = {
  startTime: 0,
  endTime: 8_000,
  width: 640,
  pixelsPerSecond: 120,
};

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
});
