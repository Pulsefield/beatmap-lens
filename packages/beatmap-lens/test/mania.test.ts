import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import holds4k from "../../../fixtures/beatmaps/holds-4k.osu?raw";
import tolerantMalformed from "../../../fixtures/beatmaps/tolerant-malformed.osu?raw";
import { parseOsu, toManiaChart } from "../src/index";

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
    expect(chart.notes.map((note) => [note.id, note.column, note.startTime, note.endTime])).toEqual(
      [
        ["note-0001", 0, 500, 500],
        ["note-0002", 1, 1000, 1000],
        ["note-0003", 2, 1000, 1000],
        ["note-0004", 3, 1500, 1500],
      ],
    );
    expect(
      chart.notes.every((note) => note.kind === "normal" && note.startTime === note.endTime),
    ).toBe(true);
  });

  it("normalizes long notes and keeps same-time ordering stable", () => {
    const chart = toManiaChart(parseOsu(holds4k));

    expect(
      chart.notes.map((note) => [
        note.id,
        note.kind,
        note.sourceKind,
        note.column,
        note.startTime,
        note.endTime,
      ]),
    ).toEqual([
      ["note-0001", "normal", "normal", 3, 500, 500],
      ["note-0002", "normal", "normal", 1, 750, 750],
      ["note-0003", "long", "hold", 0, 750, 1250],
      ["note-0004", "long", "hold", 2, 1100, 1600],
    ]);
    expect(
      chart.notes
        .filter((note) => note.kind === "long")
        .every((note) => note.endTime > note.startTime),
    ).toBe(true);
  });

  it("skips unsupported and invalid notes without rejecting the file", () => {
    const chart = toManiaChart(parseOsu(tolerantMalformed));

    expect(
      chart.notes.map((note) => [note.kind, note.column, note.startTime, note.endTime]),
    ).toEqual([
      ["normal", 0, 100, 100],
      ["long", 3, 300, 600],
      ["normal", 3, 700, 700],
    ]);
    expect(chart.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "invalid-integer-property",
        "missing-mode",
        "missing-circle-size",
        "skipped-unsupported-hitobject",
        "negative-long-note-duration",
        "x-position-out-of-range",
      ]),
    );
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
    expect(chart.sourceKeyCount).toBe(4);
    expect(
      chart.notes.map((note) => [note.kind, note.sourceKind, note.startTime, note.endTime]),
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
  });
});
