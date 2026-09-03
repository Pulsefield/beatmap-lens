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
  readonly timeMs: number;
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
  readonly startMs: number;
  readonly endMs: number;
  readonly sourceLine: number;
  readonly x: number;
  readonly hitSound: number;
}

export interface TimeRange {
  /** Half-open source-time interval [startMs, endMs). */
  readonly startMs: number;
  readonly endMs: number;
}

export interface ManiaChart {
  readonly keyCount: number;
  readonly sourceKeyCount?: number;
  readonly mode?: number;
  readonly metadata: ManiaMetadata;
  readonly notes: readonly ManiaNote[];
  readonly range: TimeRange;
  readonly diagnostics: readonly OsuDiagnostic[];
}

export interface BeatmapAudio {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
}

export interface ParseBeatmapOptions {
  readonly filename?: string;
  readonly audio?: BeatmapAudio;
}

export interface Beatmap {
  readonly osuSource: string;
  readonly osuFilename?: string;
  readonly document: ParsedOsu;
  readonly chart: ManiaChart;
  readonly audioFilename?: string;
  readonly audio?: BeatmapAudio;
}

export interface BeatmapSet {
  readonly beatmaps: readonly Beatmap[];
  readonly audios: readonly BeatmapAudio[];
}

export interface ParseOszOptions {
  readonly maxInflatedBytes?: number;
  readonly maxConcurrency?: number;
}

export interface RenderPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type RenderTimeDirection = "bottom-to-top" | "top-to-bottom";

export interface LinearRenderTimeProjection {
  readonly type: "linear";
  readonly range: TimeRange;
  readonly direction: RenderTimeDirection;
  readonly pixelsPerSecond: number;
  readonly contentTopPx: number;
  readonly contentHeightPx: number;
}

export type RenderTimeProjection = LinearRenderTimeProjection;

export type PlayfieldSize =
  | {
      readonly widthPx: number;
      readonly laneWidthPx?: never;
    }
  | {
      readonly laneWidthPx: number;
      readonly widthPx?: never;
    };

export interface RenderMetrics {
  readonly paddingPx: RenderPadding;
  readonly laneGapPx: number;
  readonly noteHeightPx: number;
  readonly noteInsetPx: number;
  readonly noteRadiusPx: number;
}

export interface RenderMetricOptions {
  readonly paddingPx?: Partial<RenderPadding>;
  readonly laneGapPx?: number;
  readonly noteHeightPx?: number;
  readonly noteInsetPx?: number;
  readonly noteRadiusPx?: number;
}

export interface RenderThemeInput {
  readonly metrics?: RenderMetricOptions;
}

export interface RenderSceneOptions {
  readonly range: TimeRange;
  readonly pixelsPerSecond?: number;
  readonly playfield?: PlayfieldSize;
  readonly timeDirection?: RenderTimeDirection;
  readonly theme?: RenderThemeInput;
}

export interface RenderScene {
  readonly kind: "mania";
  readonly keyCount: number;
  readonly size: {
    readonly widthPx: number;
    readonly heightPx: number;
  };
  readonly projection: RenderTimeProjection;
  readonly metrics: RenderMetrics;
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
  readonly startMs: number;
  readonly endMs: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly fill: string;
  readonly stroke: string;
  readonly sourceLine: number;
}

export interface SerializeSvgOptions {
  readonly title?: string;
}
