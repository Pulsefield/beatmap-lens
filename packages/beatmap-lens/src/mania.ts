import { getLastPropertyValue } from "./parser.js";
import type {
  ManiaChart,
  ManiaMetadata,
  ManiaNote,
  OsuDiagnostic,
  OsuHitObject,
  ParsedOsu,
  ToManiaChartOptions,
} from "./types.js";

type DraftNote = Omit<ManiaNote, "id">;

export function toManiaChart(parsed: ParsedOsu, _options: ToManiaChartOptions = {}): ManiaChart {
  const diagnostics: OsuDiagnostic[] = [];
  const mode = parseOptionalIntegerProperty(parsed, "General", "Mode", diagnostics);
  const sourceKeyCount = parseOptionalIntegerProperty(
    parsed,
    "Difficulty",
    "CircleSize",
    diagnostics,
  );

  if (mode === undefined) {
    diagnostics.push({
      severity: "warning",
      code: "missing-mode",
      message: "General Mode is missing; converting with the 4K mania assumptions.",
      section: "General",
    });
  } else if (mode !== 3) {
    diagnostics.push({
      severity: "warning",
      code: "unsupported-mode",
      message:
        `General Mode ${mode} is not osu!mania Mode 3; ` +
        "converting hit objects with 4K mania assumptions.",
      section: "General",
      value: String(mode),
    });
  }

  if (sourceKeyCount === undefined) {
    diagnostics.push({
      severity: "warning",
      code: "missing-circle-size",
      message: "Difficulty CircleSize is missing; defaulting to the normalized 4K model.",
      section: "Difficulty",
    });
  } else if (sourceKeyCount !== 4) {
    diagnostics.push({
      severity: "warning",
      code: "unsupported-key-count",
      message:
        `Difficulty CircleSize ${sourceKeyCount} is not 4; ` +
        "positions will be normalized into 4 columns.",
      section: "Difficulty",
      value: String(sourceKeyCount),
    });
  }

  const notes = parsed.hitObjects
    .flatMap((hitObject) => convertHitObject(hitObject, diagnostics))
    .sort(compareDraftNotes)
    .map<ManiaNote>((note, index) => ({
      id: `note-${String(index + 1).padStart(4, "0")}`,
      ...note,
    }));

  return {
    keyCount: 4,
    ...(sourceKeyCount !== undefined ? { sourceKeyCount } : {}),
    ...(mode !== undefined ? { mode } : {}),
    metadata: readMetadata(parsed),
    notes,
    diagnostics: [...parsed.diagnostics, ...diagnostics],
  };
}

function convertHitObject(hitObject: OsuHitObject, diagnostics: OsuDiagnostic[]): DraftNote[] {
  if (hitObject.kind === "normal") {
    return [
      {
        kind: "normal",
        sourceKind: "normal",
        column: columnFromX(hitObject.x, hitObject, diagnostics),
        startTime: hitObject.time,
        endTime: hitObject.time,
        sourceLine: hitObject.sourceLine,
        x: hitObject.x,
        hitSound: hitObject.hitSound,
      },
    ];
  }

  if (hitObject.kind === "hold") {
    const endTime = parseLongNoteEndTime(hitObject);
    if (endTime === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "invalid-long-note-end-time",
        message: "A mania hold note is missing a valid endTime parameter and was skipped.",
        line: hitObject.sourceLine,
        section: "HitObjects",
        value: hitObject.raw,
      });
      return [];
    }

    if (endTime < hitObject.time) {
      diagnostics.push({
        severity: "warning",
        code: "negative-long-note-duration",
        message: "A mania hold note ends before it starts and was skipped.",
        line: hitObject.sourceLine,
        section: "HitObjects",
        value: hitObject.raw,
      });
      return [];
    }

    if (endTime === hitObject.time) {
      diagnostics.push({
        severity: "warning",
        code: "zero-length-long-note",
        message: "A zero-length mania hold note was preserved as a normalized normal note.",
        line: hitObject.sourceLine,
        section: "HitObjects",
        value: hitObject.raw,
      });
      return [
        {
          kind: "normal",
          sourceKind: "hold",
          column: columnFromX(hitObject.x, hitObject, diagnostics),
          startTime: hitObject.time,
          endTime,
          sourceLine: hitObject.sourceLine,
          x: hitObject.x,
          hitSound: hitObject.hitSound,
        },
      ];
    }

    if (!Number.isInteger(endTime)) {
      diagnostics.push({
        severity: "warning",
        code: "fractional-long-note-end-time",
        message: "A mania hold note uses a fractional end time; the value was preserved.",
        line: hitObject.sourceLine,
        section: "HitObjects",
        value: String(endTime),
      });
    }

    return [
      {
        kind: "long",
        sourceKind: "hold",
        column: columnFromX(hitObject.x, hitObject, diagnostics),
        startTime: hitObject.time,
        endTime,
        sourceLine: hitObject.sourceLine,
        x: hitObject.x,
        hitSound: hitObject.hitSound,
      },
    ];
  }

  diagnostics.push({
    severity: "warning",
    code: "skipped-unsupported-hitobject",
    message: `Unsupported hit object kind ${hitObject.kind} was skipped during 4K mania conversion.`,
    line: hitObject.sourceLine,
    section: "HitObjects",
    value: hitObject.raw,
  });
  return [];
}

function columnFromX(x: number, hitObject: OsuHitObject, diagnostics: OsuDiagnostic[]): number {
  if (x < 0 || x > 512) {
    diagnostics.push({
      severity: "warning",
      code: "x-position-out-of-range",
      message: "A hit object x position falls outside the osu! playfield and was clamped.",
      line: hitObject.sourceLine,
      section: "HitObjects",
      value: String(x),
    });
  }

  return clamp(Math.floor((x * 4) / 512), 0, 3);
}

function parseLongNoteEndTime(hitObject: OsuHitObject): number | undefined {
  const encodedEndTime = hitObject.params[0]?.split(":")[0];
  if (encodedEndTime === undefined || encodedEndTime.trim() === "") {
    return undefined;
  }

  const endTime = Number(encodedEndTime);
  return Number.isFinite(endTime) ? endTime : undefined;
}

function parseOptionalIntegerProperty(
  parsed: ParsedOsu,
  sectionName: string,
  key: string,
  diagnostics: OsuDiagnostic[],
): number | undefined {
  const value = getLastPropertyValue(parsed, sectionName, key);
  if (value === undefined) {
    return undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue)) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-integer-property",
      message: `${sectionName} ${key} must be an integer.`,
      section: sectionName,
      value,
    });
    return undefined;
  }

  return Number.isSafeInteger(parsedValue) ? parsedValue : undefined;
}

function readMetadata(parsed: ParsedOsu): ManiaMetadata {
  const metadata: Record<string, string> = {};
  const title = getLastPropertyValue(parsed, "Metadata", "Title");
  const artist = getLastPropertyValue(parsed, "Metadata", "Artist");
  const creator = getLastPropertyValue(parsed, "Metadata", "Creator");
  const version = getLastPropertyValue(parsed, "Metadata", "Version");

  if (title) metadata.title = title;
  if (artist) metadata.artist = artist;
  if (creator) metadata.creator = creator;
  if (version) metadata.version = version;

  return metadata;
}

function compareDraftNotes(left: DraftNote, right: DraftNote): number {
  return (
    left.startTime - right.startTime ||
    left.endTime - right.endTime ||
    left.column - right.column ||
    left.sourceLine - right.sourceLine ||
    left.kind.localeCompare(right.kind)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
