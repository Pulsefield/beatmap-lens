import type { ManiaChart, TimeRange } from "beatmap-lens";

export function chartRenderRange(chart: ManiaChart): TimeRange {
  const firstTime = chart.notes[0]?.startMs ?? 0;
  const lastTime = Math.max(firstTime, ...chart.notes.map((note) => note.endMs));
  const startMs = Math.min(0, firstTime);
  return {
    startMs,
    endMs: Math.max(startMs + 1_000, lastTime + 500),
  };
}
