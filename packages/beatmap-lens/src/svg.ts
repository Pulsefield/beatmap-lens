import { createRenderScene } from "./render-scene.js";
import type {
  ManiaChart,
  RenderLane,
  RenderNoteGlyph,
  RenderOptions,
  RenderScene,
  RenderSvgOptions,
} from "./types.js";

export function renderSvg(
  chart: ManiaChart,
  options: RenderOptions & RenderSvgOptions = {},
): string {
  const scene = createRenderScene(chart, options);
  return serializeSvg(scene, options);
}

export function serializeSvg(scene: RenderScene, options: RenderSvgOptions = {}): string {
  const title = options.title ?? sceneTitle(scene);
  const lines = [
    tag(
      "svg",
      [
        ["xmlns", "http://www.w3.org/2000/svg"],
        ["viewBox", scene.viewBox.map(formatNumber).join(" ")],
        ["width", formatNumber(scene.width)],
        ["height", formatNumber(scene.height)],
        ["role", "img"],
        ["aria-label", title],
      ],
      false,
    ),
    `  <title>${escapeText(title)}</title>`,
    `  ${tag("rect", [
      ["x", "0"],
      ["y", "0"],
      ["width", formatNumber(scene.width)],
      ["height", formatNumber(scene.height)],
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
    ["data-start-time", String(note.startTime)],
    ["data-end-time", String(note.endTime)],
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
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(Math.round(value * 1000) / 1000);
}
