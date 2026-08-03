import { getLastPropertyValue } from "./parser.js";
import type {
  ManiaChart,
  ManiaMetadata,
  ManiaNote,
  OsuDiagnostic,
  OsuHitObject,
  ParsedOsu,
} from "./types.js";

type DraftNote = Omit<ManiaNote, "id">;

export function toManiaChart(parsed: ParsedOsu): ManiaChart {
  const diagnostics: OsuDiagnostic[] = [];
  const mode = Number(getLastPropertyValue(parsed, "General", "Mode"));
  const keyCount = Number(getLastPropertyValue(parsed, "Difficulty", "CircleSize"));

  const notes = parsed.hitObjects
    .flatMap((hitObject) => convertHitObject(hitObject, keyCount, diagnostics))
    .sort(compareDraftNotes)
    .map<ManiaNote>((note, index) => ({
      id: `note-${String(index + 1).padStart(4, "0")}`,
      ...note,
    }));

  return {
    keyCount,
    sourceKeyCount: keyCount,
    mode,
    metadata: readMetadata(parsed),
    notes,
    diagnostics: [...parsed.diagnostics, ...diagnostics],
  };
}

function convertHitObject(
  hitObject: OsuHitObject,
  keyCount: number,
  diagnostics: OsuDiagnostic[],
): DraftNote[] {
  if (hitObject.kind === "normal") {
    return [
      {
        kind: "normal",
        sourceKind: "normal",
        column: columnFromX(hitObject.x, keyCount, hitObject, diagnostics),
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
          column: columnFromX(hitObject.x, keyCount, hitObject, diagnostics),
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
        column: columnFromX(hitObject.x, keyCount, hitObject, diagnostics),
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
    message: `Unsupported hit object kind ${hitObject.kind} was skipped during ${keyCount}K mania conversion.`,
    line: hitObject.sourceLine,
    section: "HitObjects",
    value: hitObject.raw,
  });
  return [];
}

function columnFromX(
  x: number,
  keyCount: number,
  hitObject: OsuHitObject,
  diagnostics: OsuDiagnostic[],
): number {
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

  return clamp(Math.floor((x * keyCount) / 512), 0, keyCount - 1);
}

function parseLongNoteEndTime(hitObject: OsuHitObject): number | undefined {
  const encodedEndTime = hitObject.params[0]?.split(":")[0];
  if (encodedEndTime === undefined || encodedEndTime.trim() === "") {
    return undefined;
  }

  const endTime = Number(encodedEndTime);
  return Number.isFinite(endTime) ? endTime : undefined;
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
