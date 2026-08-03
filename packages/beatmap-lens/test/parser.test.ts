import { describe, expect, it } from "vitest";
import foundation4k from "../../../fixtures/beatmaps/foundation-4k.osu?raw";
import tolerantMalformed from "../../../fixtures/beatmaps/tolerant-malformed.osu?raw";
import { parseOsu } from "../src/index";
import { findSection, getLastPropertyValue } from "../src/parser";

describe("parseOsu", () => {
  it("preserves source lines, sections, properties, and hit object rows", () => {
    const parsed = parseOsu(foundation4k);

    expect(parsed.formatVersion).toBe(14);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.lines).toHaveLength(21);
    expect(parsed.lines[0]).toMatchObject({ number: 1, kind: "format" });
    expect(parsed.sections.map((section) => section.name)).toEqual([
      "General",
      "Metadata",
      "Difficulty",
      "HitObjects",
    ]);
    expect(findSection(parsed, "hitobjects")?.dataLines).toHaveLength(4);
    expect(getLastPropertyValue(parsed, "General", "Mode")).toBe("3");
    expect(getLastPropertyValue(parsed, "Difficulty", "CircleSize")).toBe("4");
    expect(parsed.hitObjects.map((hitObject) => hitObject.sourceLine)).toEqual([18, 19, 20, 21]);
  });

  it("is tolerant of BOMs and malformed rows while attaching diagnostics", () => {
    const parsed = parseOsu(tolerantMalformed);

    expect(parsed.lines[0]).toMatchObject({ kind: "format", text: "osu file format vx" });
    expect(parsed.hitObjects).toHaveLength(5);
    expect(parsed.hitObjects.map((hitObject) => hitObject.kind)).toEqual([
      "normal",
      "slider",
      "hold",
      "hold",
      "normal",
    ]);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "invalid-format-version",
        "malformed-section-header",
        "line-outside-section",
        "hitobject-too-few-fields",
        "unsupported-hitobject-kind",
      ]),
    );
    expect(parsed.diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  it("matches core section names case-insensitively", () => {
    const parsed = parseOsu(`osu file format v14

[general]
Mode:3

[difficulty]
CircleSize:4

[hitobjects]
64,192,250,1,0,0:0:0:0:
`);

    expect(getLastPropertyValue(parsed, "General", "Mode")).toBe("3");
    expect(getLastPropertyValue(parsed, "Difficulty", "CircleSize")).toBe("4");
    expect(findSection(parsed, "HitObjects")?.dataLines).toHaveLength(1);
    expect(parsed.hitObjects[0]).toMatchObject({ kind: "normal", sourceLine: 10 });
  });

  it("preserves finite fractional hit object times with a source diagnostic", () => {
    const parsed = parseOsu(`osu file format v14

[General]
Mode:3

[Difficulty]
CircleSize:4

[HitObjects]
64,192,1000.5,1,0,0:0:0:0:
`);

    expect(parsed.hitObjects[0]?.time).toBe(1000.5);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "fractional-hitobject-time",
        line: 10,
      }),
    );
  });
});
