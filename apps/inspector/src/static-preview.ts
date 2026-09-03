import { type ManiaChart, renderSvg } from "beatmap-lens";
import { chartRenderRange } from "./chart-range";

export function renderStaticPreviewSvg(chart: ManiaChart): string {
  return renderSvg(chart, {
    range: chartRenderRange(chart),
    playfield: { widthPx: 640 },
    pixelsPerSecond: 45,
  });
}
