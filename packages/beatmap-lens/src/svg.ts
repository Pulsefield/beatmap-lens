import { createRenderScene } from "./render-scene.js";
import type {
  ManiaChart,
  RenderLane,
  RenderNoteGlyph,
  RenderScene,
  RenderSceneOptions,
  SerializeSvgOptions,
} from "./types.js";

export function renderSvg(
  chart: ManiaChart,
  sceneOptions: RenderSceneOptions,
  svgOptions?: SerializeSvgOptions,
): string {
  return serializeSvg(createRenderScene(chart, sceneOptions), svgOptions);
}

export function serializeSvg(scene: RenderScene, options: SerializeSvgOptions = {}): string {
  const title = options.title ?? sceneTitle(scene);
  const { heightPx, widthPx } = scene.size;
  const lines = [
    tag(
      "svg",
      [
        ["xmlns", "http://www.w3.org/2000/svg"],
        ["viewBox", `0 0 ${formatNumber(widthPx)} ${formatNumber(heightPx)}`],
        ["width", formatNumber(widthPx)],
        ["height", formatNumber(heightPx)],
        ["role", "img"],
        ["aria-label", title],
      ],
      false,
    ),
    `  <title>${escapeText(title)}</title>`,
    `  ${tag("rect", [
      ["x", "0"],
      ["y", "0"],
      ["width", formatNumber(widthPx)],
      ["height", formatNumber(heightPx)],
      ["fill", "#101820"],
    ])}`,
    `  ${tag("g", [["data-layer", "lanes"]], false)}`,
    ...scene.lanes.map((lane) => `    ${renderLane(lane)}`),
    "  </g>",
    `  ${tag("g", [["data-layer", "notes"]], false)}`,
    ...scene.notes.map((note) => `    ${renderNote(note)}`),
    "  </g>",
    "</svg>",
  ];

  return `${lines.join("\n")}\n`;
}

function renderLane(lane: RenderLane): string {
  return tag("rect", [
    ["data-column", String(lane.column)],
    ["x", formatNumber(lane.x)],
    ["y", formatNumber(lane.y)],
    ["width", formatNumber(lane.width)],
    ["height", formatNumber(lane.height)],
    ["fill", lane.fill],
    ["stroke", lane.stroke],
  ]);
}

function renderNote(note: RenderNoteGlyph): string {
  return tag("rect", [
    ["id", note.id],
    ["data-kind", note.kind],
    ["data-source-kind", note.sourceKind],
    ["data-column", String(note.column)],
    ["data-start-ms", String(note.startMs)],
    ["data-end-ms", String(note.endMs)],
    ...(note.continuesBefore ? ([["data-continues-before", "true"]] as const) : []),
    ...(note.continuesAfter ? ([["data-continues-after", "true"]] as const) : []),
    ["data-source-line", String(note.sourceLine)],
    ["x", formatNumber(note.x)],
    ["y", formatNumber(note.y)],
    ["width", formatNumber(note.width)],
    ["height", formatNumber(note.height)],
    ["rx", formatNumber(note.radius)],
    ["fill", note.fill],
    ["stroke", note.stroke],
  ]);
}

function tag(
  name: string,
  attributes: readonly (readonly [name: string, value: string])[],
  selfClosing = true,
): string {
  const serializedAttributes = attributes
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ");
  return selfClosing ? `<${name} ${serializedAttributes}/>` : `<${name} ${serializedAttributes}>`;
}

function sceneTitle(scene: RenderScene): string {
  const parts = [scene.metadata.artist, scene.metadata.title, scene.metadata.version].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  const chartLabel = `${scene.keyCount}K mania chart`;
  return parts.length > 0 ? `${parts.join(" - ")} ${chartLabel}` : chartLabel;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatNumber(value: number): string {
  return String(value);
}
