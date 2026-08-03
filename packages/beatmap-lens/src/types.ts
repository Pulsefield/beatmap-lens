export type DiagnosticSeverity = "warning" | "error";

export interface OsuDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly section?: string;
  readonly value?: string;
}

export type OsuSourceLineKind =
  | "blank"
  | "comment"
  | "format"
  | "section"
  | "property"
  | "data"
  | "malformed";

export interface OsuSourceLine {
  readonly number: number;
  readonly text: string;
  readonly kind: OsuSourceLineKind;
  readonly section?: string;
  readonly key?: string;
  readonly value?: string;
  readonly fields?: readonly string[];
  readonly diagnostics: readonly OsuDiagnostic[];
}

export interface OsuProperty {
  readonly section: string;
  readonly key: string;
  readonly value: string;
  readonly line: number;
  readonly raw: string;
}

export interface OsuSection {
  readonly name: string;
  readonly headerLine: number;
  readonly lines: readonly OsuSourceLine[];
  readonly properties: readonly OsuProperty[];
  readonly dataLines: readonly OsuSourceLine[];
}

export type OsuHitObjectKind = "normal" | "hold" | "slider" | "spinner" | "unknown";

export interface OsuHitObject {
  readonly kind: OsuHitObjectKind;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly type: number;
  readonly hitSound: number;
  readonly params: readonly string[];
  readonly rawFields: readonly string[];
  readonly sourceLine: number;
  readonly raw: string;
  readonly diagnostics: readonly OsuDiagnostic[];
}

export interface ParsedOsu {
  readonly formatVersion?: number;
  readonly lines: readonly OsuSourceLine[];
  readonly sections: readonly OsuSection[];
  readonly properties: readonly OsuProperty[];
  readonly hitObjects: readonly OsuHitObject[];
  readonly diagnostics: readonly OsuDiagnostic[];
}

export interface ManiaMetadata {
  readonly title?: string;
  readonly artist?: string;
  readonly creator?: string;
  readonly version?: string;
}

export type ManiaNoteKind = "normal" | "long";

export interface ManiaNote {
  readonly id: string;
  readonly kind: ManiaNoteKind;
  readonly sourceKind: "normal" | "hold";
  readonly column: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly sourceLine: number;
  readonly x: number;
  readonly hitSound: number;
}

export interface ManiaChart {
  readonly keyCount: number;
  readonly sourceKeyCount?: number;
  readonly mode?: number;
  readonly metadata: ManiaMetadata;
  readonly notes: readonly ManiaNote[];
  readonly diagnostics: readonly OsuDiagnostic[];
}

export interface RenderPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface RenderOptions {
  readonly startTime?: number;
  readonly endTime?: number;
  readonly width?: number;
  readonly pixelsPerSecond?: number;
  readonly laneWidth?: number;
  readonly laneGap?: number;
  readonly noteHeight?: number;
  readonly padding?: Partial<RenderPadding>;
}

export interface RenderScene {
  readonly kind: "mania";
  readonly keyCount: number;
  readonly width: number;
  readonly height: number;
  readonly viewBox: readonly [number, number, number, number];
  readonly timeRange: {
    readonly startTime: number;
    readonly endTime: number;
    readonly pixelsPerMillisecond: number;
    readonly pixelsPerSecond: number;
  };
  readonly padding: RenderPadding;
  readonly metadata: ManiaMetadata;
  readonly lanes: readonly RenderLane[];
  readonly notes: readonly RenderNoteGlyph[];
}

export interface RenderLane {
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly fill: string;
  readonly stroke: string;
}

export interface RenderNoteGlyph {
  readonly id: string;
  readonly kind: ManiaNoteKind;
  readonly sourceKind: "normal" | "hold";
  readonly column: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly fill: string;
  readonly stroke: string;
  readonly sourceLine: number;
}

export interface RenderSvgOptions {
  readonly title?: string;
}
