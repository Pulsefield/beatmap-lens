import type {
  OsuDiagnostic,
  OsuHitObject,
  OsuHitObjectKind,
  OsuProperty,
  OsuSection,
  OsuSourceLine,
  OsuSourceLineKind,
  ParsedOsu,
} from "./types.js";

interface MutableSection {
  name: string;
  headerLine: number;
  lines: OsuSourceLine[];
  properties: OsuProperty[];
  dataLines: OsuSourceLine[];
}

const dataOnlySections = new Set(["events", "timingpoints", "hitobjects"]);

export function parseOsu(source: string): ParsedOsu {
  const normalizedSource = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const rawLines = splitSourceLines(normalizedSource);
  const lines: OsuSourceLine[] = [];
  const sections: MutableSection[] = [];
  const properties: OsuProperty[] = [];
  const hitObjects: OsuHitObject[] = [];
  const diagnostics: OsuDiagnostic[] = [];
  let currentSection: MutableSection | undefined;
  let formatVersion: number | undefined;

  if (rawLines.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "empty-file",
      message: "The .osu source is empty.",
    });
  }

  for (let index = 0; index < rawLines.length; index += 1) {
    const number = index + 1;
    const text = rawLines[index] ?? "";
    const trimmed = text.trim();
    const lineDiagnostics: OsuDiagnostic[] = [];
    let kind: OsuSourceLineKind = "data";
    let key: string | undefined;
    let value: string | undefined;
    let fields: string[] | undefined;

    const addLineDiagnostic = (diagnostic: OsuDiagnostic): void => {
      diagnostics.push(diagnostic);
      lineDiagnostics.push(diagnostic);
    };

    if (trimmed === "") {
      kind = "blank";
    } else if (trimmed.startsWith("//")) {
      kind = "comment";
    } else if (number === 1 && /^osu file format v/i.test(trimmed)) {
      kind = "format";
      const match = /^osu file format v(\d+)$/i.exec(trimmed);
      if (match) {
        formatVersion = Number.parseInt(match[1] ?? "", 10);
      } else {
        addLineDiagnostic({
          severity: "warning",
          code: "invalid-format-version",
          message: "The osu! file format line is present but does not contain a numeric version.",
          line: number,
          value: text,
        });
      }
    } else {
      const sectionMatch = /^\[([^\]\r\n]+)\]$/.exec(trimmed);
      if (sectionMatch) {
        kind = "section";
        currentSection = {
          name: sectionMatch[1] ?? "",
          headerLine: number,
          lines: [],
          properties: [],
          dataLines: [],
        };
        sections.push(currentSection);
      } else if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
        kind = "malformed";
        addLineDiagnostic({
          severity: "warning",
          code: "malformed-section-header",
          message: "The section header is malformed and was ignored.",
          line: number,
          ...(currentSection ? { section: currentSection.name } : {}),
          value: text,
        });
      } else if (currentSection) {
        const sectionName = currentSection.name;
        if (equalsIgnoreCase(sectionName, "HitObjects")) {
          kind = "data";
          fields = text.split(",").map((field) => field.trim());
        } else if (isPropertySection(sectionName)) {
          const parsedProperty = parseProperty(text);
          if (parsedProperty) {
            kind = "property";
            key = parsedProperty.key;
            value = parsedProperty.value;
          } else {
            kind = "malformed";
            addLineDiagnostic({
              severity: "warning",
              code: "malformed-property",
              message: "Expected a key/value property separated by a colon.",
              line: number,
              section: sectionName,
              value: text,
            });
          }
        } else {
          kind = "data";
          fields = text.split(",").map((field) => field.trim());
        }
      } else {
        kind = "data";
        addLineDiagnostic({
          severity: "warning",
          code: "line-outside-section",
          message: "A non-empty line appeared before any section header.",
          line: number,
          value: text,
        });
      }
    }

    const sourceLine: OsuSourceLine = {
      number,
      text,
      kind,
      ...(currentSection && kind !== "section" ? { section: currentSection.name } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(fields ? { fields } : {}),
      diagnostics: lineDiagnostics,
    };

    lines.push(sourceLine);

    if (kind === "property" && currentSection && key !== undefined && value !== undefined) {
      const property: OsuProperty = {
        section: currentSection.name,
        key,
        value,
        line: number,
        raw: text,
      };
      currentSection.properties.push(property);
      properties.push(property);
    }

    if (currentSection && kind !== "section") {
      currentSection.lines.push(sourceLine);
      if (kind === "data") {
        currentSection.dataLines.push(sourceLine);
      }
    }

    if (
      currentSection &&
      equalsIgnoreCase(currentSection.name, "HitObjects") &&
      kind === "data" &&
      fields
    ) {
      const hitObject = parseHitObjectLine(text, fields, number, lineDiagnostics, diagnostics);
      if (hitObject) {
        hitObjects.push(hitObject);
      }
    }
  }

  if (rawLines.length > 0 && formatVersion === undefined) {
    const firstLine = rawLines[0]?.trim() ?? "";
    if (!/^osu file format v/i.test(firstLine)) {
      diagnostics.push({
        severity: "warning",
        code: "missing-format-line",
        message: "The first line is not an osu! file format declaration.",
        line: 1,
        value: rawLines[0] ?? "",
      });
    }
  }

  return {
    ...(formatVersion !== undefined ? { formatVersion } : {}),
    lines,
    sections,
    properties,
    hitObjects,
    diagnostics,
  };
}

export function findSection(parsed: ParsedOsu, name: string): OsuSection | undefined {
  return parsed.sections.find((section) => equalsIgnoreCase(section.name, name));
}

export function getProperties(
  parsed: ParsedOsu,
  sectionName: string,
  key?: string,
): readonly OsuProperty[] {
  return parsed.properties.filter((property) => {
    if (!equalsIgnoreCase(property.section, sectionName)) {
      return false;
    }
    return key === undefined || equalsIgnoreCase(property.key, key);
  });
}

export function getLastPropertyValue(
  parsed: ParsedOsu,
  sectionName: string,
  key: string,
): string | undefined {
  const matches = getProperties(parsed, sectionName, key);
  return matches.length > 0 ? matches[matches.length - 1]?.value : undefined;
}

function splitSourceLines(source: string): string[] {
  if (source.length === 0) {
    return [];
  }

  const lines = source.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function isPropertySection(sectionName: string): boolean {
  return !dataOnlySections.has(sectionName.toLowerCase());
}

function parseProperty(text: string): { key: string; value: string } | undefined {
  const separatorIndex = text.indexOf(":");
  if (separatorIndex < 0) {
    return undefined;
  }

  const key = text.slice(0, separatorIndex).trim();
  const value = text.slice(separatorIndex + 1).trim();
  if (key.length === 0) {
    return undefined;
  }

  return { key, value };
}

function parseHitObjectLine(
  raw: string,
  fields: readonly string[],
  sourceLine: number,
  lineDiagnostics: OsuDiagnostic[],
  allDiagnostics: OsuDiagnostic[],
): OsuHitObject | undefined {
  const addDiagnostic = (diagnostic: OsuDiagnostic): void => {
    allDiagnostics.push(diagnostic);
    lineDiagnostics.push(diagnostic);
  };

  if (fields.length < 5) {
    addDiagnostic({
      severity: "warning",
      code: "hitobject-too-few-fields",
      message: "A HitObjects row must contain at least x,y,time,type,hitSound.",
      line: sourceLine,
      section: "HitObjects",
      value: raw,
    });
    return undefined;
  }

  const x = parseInteger(fields[0]);
  const y = parseInteger(fields[1]);
  const timeMs = parseFiniteNumber(fields[2]);
  const type = parseInteger(fields[3]);
  const hitSound = parseInteger(fields[4]);
  if (
    x === undefined ||
    y === undefined ||
    timeMs === undefined ||
    type === undefined ||
    hitSound === undefined
  ) {
    addDiagnostic({
      severity: "warning",
      code: "hitobject-invalid-number",
      message: "A HitObjects row contains a non-integer required field.",
      line: sourceLine,
      section: "HitObjects",
      value: raw,
    });
    return undefined;
  }

  if (!Number.isInteger(timeMs)) {
    addDiagnostic({
      severity: "warning",
      code: "fractional-hitobject-time",
      message: "A HitObjects row uses a fractional start time; the value was preserved.",
      line: sourceLine,
      section: "HitObjects",
      value: fields[2] ?? "",
    });
  }

  const kind = classifyHitObject(type);
  if (kind === "slider" || kind === "spinner" || kind === "unknown") {
    addDiagnostic({
      severity: "warning",
      code: "unsupported-hitobject-kind",
      message: `Hit object type ${type} is not an osu!mania note or hold and will not convert to a note.`,
      line: sourceLine,
      section: "HitObjects",
      value: raw,
    });
  }

  return {
    kind,
    x,
    y,
    timeMs,
    type,
    hitSound,
    params: fields.slice(5),
    rawFields: [...fields],
    sourceLine,
    raw,
    diagnostics: [...lineDiagnostics],
  };
}

function classifyHitObject(type: number): OsuHitObjectKind {
  if ((type & 128) !== 0) {
    return "hold";
  }
  if ((type & 1) !== 0) {
    return "normal";
  }
  if ((type & 2) !== 0) {
    return "slider";
  }
  if ((type & 8) !== 0) {
    return "spinner";
  }
  return "unknown";
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
