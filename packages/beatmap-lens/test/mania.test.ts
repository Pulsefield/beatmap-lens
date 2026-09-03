import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import holds4k from "../../../fixtures/beatmaps/holds-4k.osu?raw";
import { parseOsu, toManiaChart } from "../src/index";

const supportedKeyCounts = [4, 5, 6, 7, 8, 9, 10];

describe("toManiaChart", () => {
  it("normalizes 4K normal notes with deterministic order and ids", () => {
    const chart = toManiaChart(parseOsu(foundation4k));

    expect(chart.keyCount).toBe(4);
    expect(chart.sourceKeyCount).toBe(4);
    expect(chart.mode).toBe(3);
    expect(chart.metadata).toEqual({
      title: "Foundation 4K",
      artist: "Beatmap Lens",
      creator: "Beatmap Lens",
      version: "Normal",
    });
    expect(chart.notes.map((note) => [note.id, note.column, note.startMs, note.endMs])).toEqual([
      ["note-0001", 0, 500, 500],
      ["note-0002", 1, 1000, 1000],
      ["note-0003", 2, 1000, 1000],
      ["note-0004", 3, 1500, 1500],
    ]);
    expect(chart.notes.every((note) => note.kind === "normal" && note.startMs === note.endMs)).toBe(
      true,
    );
    expect(chart.range).toEqual({ startMs: 0, endMs: 1501 });
  });

  it.each(supportedKeyCounts)(
    "detects %iK from CircleSize and maps every lane without coercion",
    (keyCount) => {
      const chart = toManiaChart(parseOsu(maniaSource(keyCount)));

      expect(chart.keyCount).toBe(keyCount);
      expect(chart.sourceKeyCount).toBe(keyCount);
      expect(chart.notes.map((note) => note.column)).toEqual(
        Array.from({ length: keyCount }, (_, column) => column),
      );
      expect(chart.notes.map((note) => note.kind)).toEqual(
        Array.from({ length: keyCount }, (_, column) => (column % 2 === 0 ? "normal" : "long")),
      );
    },
  );

  it("normalizes long notes and keeps same-time ordering stable", () => {
    const chart = toManiaChart(parseOsu(holds4k));

    expect(
      chart.notes.map((note) => [
        note.id,
        note.kind,
        note.sourceKind,
        note.column,
        note.startMs,
        note.endMs,
      ]),
    ).toEqual([
      ["note-0001", "normal", "normal", 3, 500, 500],
      ["note-0002", "normal", "normal", 1, 750, 750],
      ["note-0003", "long", "hold", 0, 750, 1250],
      ["note-0004", "long", "hold", 2, 1100, 1600],
    ]);
    expect(
      chart.notes.filter((note) => note.kind === "long").every((note) => note.endMs > note.startMs),
    ).toBe(true);
    expect(chart.range).toEqual({ startMs: 0, endMs: 1601 });
  });

  it("accepts integral decimal properties and preserves fractional note times", () => {
    const chart = toManiaChart(
      parseOsu(`osu file format v14

[General]
Mode:3.0

[Difficulty]
CircleSize:4.0

[HitObjects]
64,192,1000.5,1,0,0:0:0:0:
192,192,2000.5,128,0,2000.5:0:0:0:0:
320,192,3000.25,128,0,3500.75:0:0:0:0:
`),
    );

    expect(chart.mode).toBe(3);
    expect(chart.keyCount).toBe(4);
    expect(chart.sourceKeyCount).toBe(4);
    expect(
      chart.notes.map((note) => [note.kind, note.sourceKind, note.startMs, note.endMs]),
    ).toEqual([
      ["normal", "normal", 1000.5, 1000.5],
      ["normal", "hold", 2000.5, 2000.5],
      ["long", "hold", 3000.25, 3500.75],
    ]);
    expect(chart.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "fractional-hitobject-time",
        "fractional-long-note-end-time",
        "zero-length-long-note",
      ]),
    );
    expect(chart.range).toEqual({ startMs: 0, endMs: 3501.75 });
  });

  it("exposes a non-empty complete-chart range for an empty chart", () => {
    const chart = toManiaChart(
      parseOsu(`osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
`),
    );

    expect(chart.notes).toEqual([]);
    expect(chart.range).toEqual({ startMs: 0, endMs: 1 });
  });

  it("includes negative source timestamps in the complete-chart range", () => {
    const chart = toManiaChart(
      parseOsu(`osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
64,192,-250,1,0,0:0:0:0:
`),
    );

    expect(chart.range).toEqual({ startMs: -250, endMs: -249 });
  });
});

function maniaSource(keyCount: number): string {
  const hitObjects = Array.from({ length: keyCount }, (_, column) => {
    const x = Math.floor(((column + 0.5) * 512) / keyCount);
    const startTime = 100 + column * 100;
    return column % 2 === 0
      ? `${x},192,${startTime},1,0,0:0:0:0:`
      : `${x},192,${startTime},128,0,${startTime + 50}:0:0:0:0:`;
  }).join("\n");

  return `osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:${keyCount}

[HitObjects]
${hitObjects}
`;
}
