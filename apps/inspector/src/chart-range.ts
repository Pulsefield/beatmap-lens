import type { ManiaChart } from "beatmap-lens";

export function chartRenderRange(chart: ManiaChart): { startTime: number; endTime: number } {
  const firstTime = chart.notes[0]?.startTime ?? 0;
  const lastTime = Math.max(firstTime, ...chart.notes.map((note) => note.endTime));
  const startTime = Math.min(0, firstTime);
  return {
    startTime,
    endTime: Math.max(startTime + 1_000, lastTime + 500),
  };
}
