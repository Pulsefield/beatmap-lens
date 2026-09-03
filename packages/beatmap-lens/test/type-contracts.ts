import {
  type Beatmap,
  type BeatmapAudio,
  type BeatmapSet,
  createRenderDocument,
  createRenderScene,
  type DiagnosticSeverity,
  type LinearRenderTimeProjection,
  type ManiaChart,
  type ManiaMetadata,
  type ManiaNote,
  type ManiaNoteKind,
  type OsuDiagnostic,
  type OsuHitObject,
  type OsuHitObjectKind,
  type OsuLazerManiaPixelsPerSecondOptions,
  type OsuProperty,
  type OsuSection,
  type OsuSourceLine,
  type OsuSourceLineKind,
  type ParseBeatmapOptions,
  type ParsedOsu,
  type ParseOszOptions,
  type PiecewiseLinearRenderTimeProjection,
  type PlayfieldSize,
  type RenderDiagnostic,
  type RenderDocument,
  type RenderDocumentOptions,
  type RenderDocumentScaleInput,
  type RenderLane,
  type RenderMetricOptions,
  type RenderMetrics,
  type RenderNoteGlyph,
  type RenderPadding,
  type RenderPaddingInput,
  type RenderPage,
  type RenderPanel,
  type RenderScene,
  type RenderSceneOptions,
  type RenderThemeInput,
  type RenderTimeAxis,
  type RenderTimeAxisInput,
  type RenderTimeAxisTick,
  type RenderTimeCompressionMark,
  type RenderTimeDirection,
  type RenderTimeProjection,
  type ResolvedPlayfieldSize,
  type ResolvedRenderDocumentOptions,
  type ResolvedRenderDocumentScale,
  type ResolvedRenderTimeAxisOptions,
  renderSvg,
  renderSvgPages,
  type SerializedSvgPage,
  type SerializeSvgOptions,
  type SerializeSvgPagesOptions,
  type SizePx,
  serializeSvg,
  serializeSvgPages,
  type TimeRange,
} from "../src/index.js";

export interface PublicTypeContract {
  Beatmap: Beatmap;
  BeatmapAudio: BeatmapAudio;
  BeatmapSet: BeatmapSet;
  DiagnosticSeverity: DiagnosticSeverity;
  LinearRenderTimeProjection: LinearRenderTimeProjection;
  ManiaChart: ManiaChart;
  ManiaMetadata: ManiaMetadata;
  ManiaNote: ManiaNote;
  ManiaNoteKind: ManiaNoteKind;
  OsuDiagnostic: OsuDiagnostic;
  OsuHitObject: OsuHitObject;
  OsuHitObjectKind: OsuHitObjectKind;
  OsuLazerManiaPixelsPerSecondOptions: OsuLazerManiaPixelsPerSecondOptions;
  OsuProperty: OsuProperty;
  OsuSection: OsuSection;
  OsuSourceLine: OsuSourceLine;
  OsuSourceLineKind: OsuSourceLineKind;
  ParsedOsu: ParsedOsu;
  ParseBeatmapOptions: ParseBeatmapOptions;
  ParseOszOptions: ParseOszOptions;
  PiecewiseLinearRenderTimeProjection: PiecewiseLinearRenderTimeProjection;
  PlayfieldSize: PlayfieldSize;
  RenderDiagnostic: RenderDiagnostic;
  RenderDocument: RenderDocument;
  RenderDocumentOptions: RenderDocumentOptions;
  RenderDocumentScaleInput: RenderDocumentScaleInput;
  RenderLane: RenderLane;
  RenderMetricOptions: RenderMetricOptions;
  RenderMetrics: RenderMetrics;
  RenderNoteGlyph: RenderNoteGlyph;
  RenderPage: RenderPage;
  RenderPadding: RenderPadding;
  RenderPaddingInput: RenderPaddingInput;
  RenderPanel: RenderPanel;
  ResolvedPlayfieldSize: ResolvedPlayfieldSize;
  ResolvedRenderDocumentOptions: ResolvedRenderDocumentOptions;
  ResolvedRenderDocumentScale: ResolvedRenderDocumentScale;
  ResolvedRenderTimeAxisOptions: ResolvedRenderTimeAxisOptions;
  RenderScene: RenderScene;
  RenderSceneOptions: RenderSceneOptions;
  RenderThemeInput: RenderThemeInput;
  RenderTimeAxis: RenderTimeAxis;
  RenderTimeAxisInput: RenderTimeAxisInput;
  RenderTimeAxisTick: RenderTimeAxisTick;
  RenderTimeCompressionMark: RenderTimeCompressionMark;
  RenderTimeDirection: RenderTimeDirection;
  RenderTimeProjection: RenderTimeProjection;
  SerializedSvgPage: SerializedSvgPage;
  SerializeSvgOptions: SerializeSvgOptions;
  SerializeSvgPagesOptions: SerializeSvgPagesOptions;
  SizePx: SizePx;
  TimeRange: TimeRange;
}

export function assertRequiredDocumentRange(chart: ManiaChart): void {
  const options: RenderDocumentOptions = { range: chart.range };
  const document = createRenderDocument(chart, options);

  renderSvgPages(chart, options);
  serializeSvgPages(document);

  // @ts-expect-error -- a bounded range is required for every document.
  createRenderDocument(chart);
  // @ts-expect-error -- an empty options object cannot select a document operation.
  createRenderDocument(chart, {});
  // @ts-expect-error -- the SVG pages shortcut has the same required range.
  renderSvgPages(chart, {});
}

export function assertRequiredRenderRange(chart: ManiaChart): void {
  // @ts-expect-error -- a bounded range is required for every scene.
  createRenderScene(chart);
  // @ts-expect-error -- an empty options object cannot select a render operation.
  createRenderScene(chart, {});
  // @ts-expect-error -- both half-open range endpoints are required.
  createRenderScene(chart, { range: { startMs: 0 } });
  // @ts-expect-error -- the SVG shortcut is bounded too.
  renderSvg(chart);
  // @ts-expect-error -- the SVG shortcut also rejects empty options.
  renderSvg(chart, {});
}

export function assertPlayfieldSizeXor(chart: ManiaChart): void {
  createRenderScene(chart, { range: chart.range, playfield: { widthPx: 640 } });
  createRenderScene(chart, { range: chart.range, playfield: { laneWidthPx: 120 } });
  createRenderScene(chart, {
    range: chart.range,
    theme: { metrics: { paddingPx: { left: 20 }, noteInsetPx: 4 } },
  });

  createRenderScene(chart, {
    range: chart.range,
    // @ts-expect-error -- playfield sizing accepts exactly one width strategy.
    playfield: { widthPx: 640, laneWidthPx: 120 },
  });
  createRenderScene(chart, {
    range: chart.range,
    // @ts-expect-error -- a supplied playfield must select one width strategy.
    playfield: {},
  });
  // @ts-expect-error -- geometry options are nested by user-facing concern.
  createRenderScene(chart, { range: chart.range, width: 640 });
}

export function assertSceneAndSerializerOptionsAreSeparate(chart: ManiaChart): void {
  const sceneOptions: RenderSceneOptions = { range: chart.range };
  const svgOptions: SerializeSvgOptions = { title: "Contract title" };
  const scene = createRenderScene(chart, sceneOptions);

  renderSvg(chart, sceneOptions, svgOptions);
  serializeSvg(scene, svgOptions);

  // @ts-expect-error -- SVG metadata is not part of scene geometry.
  createRenderScene(chart, { range: chart.range, title: "Mixed concerns" });
  // @ts-expect-error -- SVG metadata is not part of scene geometry.
  renderSvg(chart, { range: chart.range, title: "Mixed concerns" });
  // @ts-expect-error -- scene geometry is not accepted by the SVG serializer.
  serializeSvg(scene, { pixelsPerSecond: 240 });
  // @ts-expect-error -- scene geometry is not accepted by the SVG serializer.
  serializeSvg(scene, { playfield: { widthPx: 640 } });
  // @ts-expect-error -- the third renderSvg argument accepts serializer options only.
  renderSvg(chart, sceneOptions, { pixelsPerSecond: 240 });
}

// @ts-expect-error -- the pre-foundation SVG option name is no longer public.
export type RemovedRenderSvgOptions = import("../src/index.js").RenderSvgOptions;
// @ts-expect-error -- the old flat scene option name is no longer public.
export type RemovedRenderOptions = import("../src/index.js").RenderOptions;
// @ts-expect-error -- parsing uses ParseBeatmapOptions rather than a constructor input type.
export type RemovedBeatmapInput = import("../src/index.js").BeatmapInput;
// @ts-expect-error -- resolved dimensions live under scene.size.
export type RemovedSceneWidth = RenderScene["width"];
// @ts-expect-error -- resolved dimensions live under scene.size.
export type RemovedSceneHeight = RenderScene["height"];
// @ts-expect-error -- serializer viewBox is derived from scene.size.
export type RemovedSceneViewBox = RenderScene["viewBox"];
// @ts-expect-error -- range, direction, and scale live under scene.projection.
export type RemovedSceneTimeRange = RenderScene["timeRange"];
// @ts-expect-error -- range, direction, and scale live under scene.projection.
export type RemovedSceneTimeDirection = RenderScene["timeDirection"];
// @ts-expect-error -- resolved padding lives under scene.metrics.
export type RemovedScenePadding = RenderScene["padding"];
