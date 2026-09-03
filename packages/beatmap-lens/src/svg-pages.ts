import { createRenderDocument } from "./render-document.js";
import { escapeText, formatNumber, sceneTitle, serializeSceneLayers, tag } from "./svg.js";
import type {
  ManiaChart,
  RenderDocument,
  RenderDocumentOptions,
  RenderPanel,
  RenderTimeAxis,
  RenderTimeAxisTick,
  SerializedSvgPage,
  SerializeSvgPagesOptions,
} from "./types.js";

const pageBackground = "#101820";
const axisStroke = "#627386";
const axisText = "#9aabbc";
const axisFontSizePx = 7;

export function renderSvgPages(
  chart: ManiaChart,
  documentOptions: RenderDocumentOptions,
  svgOptions?: SerializeSvgPagesOptions,
): readonly SerializedSvgPage[] {
  return serializeSvgPages(createRenderDocument(chart, documentOptions), svgOptions);
}

export function serializeSvgPages(
  document: RenderDocument,
  options: SerializeSvgPagesOptions = {},
): readonly SerializedSvgPage[] {
  const count = document.pages.length;
  const firstPanel = document.pages.flatMap((page) => page.panels)[0] as RenderPanel;
  const baseTitle = options.title ?? sceneTitle(firstPanel.scene);

  return document.pages.map((page) => {
    const title = `${baseTitle} - page ${page.index + 1} of ${count}`;
    return {
      index: page.index,
      count,
      range: page.range,
      size: page.size,
      svg: serializePage(document, page, title),
    };
  });
}

function serializePage(
  document: RenderDocument,
  page: RenderDocument["pages"][number],
  title: string,
): string {
  const { heightPx, widthPx } = page.size;
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
      ["data-layer", "page-background"],
      ["x", "0"],
      ["y", "0"],
      ["width", formatNumber(widthPx)],
      ["height", formatNumber(heightPx)],
      ["fill", pageBackground],
    ])}`,
    ...serializeClipPaths(page.panels),
    ...page.panels.flatMap((panel) => serializePanel(document, panel)),
    "</svg>",
  ];

  return `${lines.join("\n")}\n`;
}

function serializeClipPaths(panels: readonly RenderPanel[]): readonly string[] {
  return [
    "  <defs>",
    ...panels.flatMap((panel) => {
      const prefix = panelPrefix(panel);
      const lines = [
        `    ${tag(
          "clipPath",
          [
            ["id", `${prefix}-clip`],
            ["clipPathUnits", "userSpaceOnUse"],
          ],
          false,
        )}`,
        `      ${tag("rect", [
          ["x", "0"],
          ["y", "0"],
          ["width", formatNumber(panel.frame.width)],
          ["height", formatNumber(panel.frame.height)],
        ])}`,
        "    </clipPath>",
      ];
      if (panel.timeAxis) {
        lines.push(
          `    ${tag(
            "clipPath",
            [
              ["id", `${prefix}-axis-clip`],
              ["clipPathUnits", "userSpaceOnUse"],
            ],
            false,
          )}`,
          `      ${tag("rect", [
            ["x", "0"],
            ["y", "0"],
            ["width", formatNumber(panel.timeAxis.widthPx)],
            ["height", formatNumber(panel.frame.height)],
          ])}`,
          "    </clipPath>",
        );
      }
      return lines;
    }),
    "  </defs>",
  ];
}

function serializePanel(document: RenderDocument, panel: RenderPanel): readonly string[] {
  const prefix = panelPrefix(panel);
  const axis = panel.timeAxis;
  const sceneX = axis?.side === "left" ? axis.widthPx + axis.gapPx : 0;
  const lines = [
    `  ${tag(
      "g",
      [
        ["data-panel-index", String(panel.index)],
        ["data-time-scale", document.resolved.scale.type],
        ["transform", `translate(${formatNumber(panel.frame.x)} ${formatNumber(panel.frame.y)})`],
        ["clip-path", `url(#${prefix}-clip)`],
      ],
      false,
    )}`,
    `    ${tag(
      "g",
      [
        ["data-layer", "scene"],
        ["transform", `translate(${formatNumber(sceneX)} 0)`],
      ],
      false,
    )}`,
    ...serializeSceneLayers(panel.scene, {
      indent: "      ",
      noteIdPrefix: prefix,
    }),
    "    </g>",
  ];

  if (axis) {
    lines.push(
      ...serializeTimeAxis(
        axis,
        axis.side === "left" ? 0 : panel.scene.size.widthPx + axis.gapPx,
        prefix,
        document.resolved.timeAxis !== false && document.resolved.timeAxis.showCompressionMarks,
      ),
    );
  }

  lines.push("  </g>");
  return lines;
}

function serializeTimeAxis(
  axis: RenderTimeAxis,
  x: number,
  prefix: string,
  showCompressionMarks: boolean,
): readonly string[] {
  const railX = axis.side === "left" ? axis.widthPx : 0;
  const tickX = axis.side === "left" ? railX - 4 : railX + 4;
  const axisYs = axis.ticks.map((tick) => tick.y);
  const topY = Math.min(...axisYs);
  const bottomY = Math.max(...axisYs);

  return [
    `    ${tag(
      "g",
      [
        ["data-layer", "time-axis"],
        ["data-side", axis.side],
        ["transform", `translate(${formatNumber(x)} 0)`],
        ["clip-path", `url(#${prefix}-axis-clip)`],
      ],
      false,
    )}`,
    `      ${tag("line", [
      ["data-kind", "rail"],
      ["x1", formatNumber(railX)],
      ["y1", formatNumber(topY)],
      ["x2", formatNumber(railX)],
      ["y2", formatNumber(bottomY)],
      ["stroke", axisStroke],
      ["stroke-width", "1"],
    ])}`,
    ...axis.ticks.flatMap((tick) => serializeTimeAxisTick(tick, axis.widthPx, railX, tickX)),
    ...(showCompressionMarks
      ? axis.compressionMarks.flatMap((mark) => {
          const direction = axis.side === "left" ? -1 : 1;
          return [
            `      ${tag(
              "g",
              [
                ["data-kind", "compression-mark"],
                ["data-start-ms", String(mark.range.startMs)],
                ["data-end-ms", String(mark.range.endMs)],
              ],
              false,
            )}`,
            ...[1, 4].map(
              (offset) =>
                `        ${tag("line", [
                  ["x1", formatNumber(railX + direction * offset)],
                  ["y1", formatNumber(mark.y + 2)],
                  ["x2", formatNumber(railX + direction * (offset + 3))],
                  ["y2", formatNumber(mark.y - 2)],
                  ["stroke", axisStroke],
                  ["stroke-width", "1"],
                ])}`,
            ),
            "      </g>",
          ];
        })
      : []),
    "    </g>",
  ];
}

function serializeTimeAxisTick(
  tick: RenderTimeAxisTick,
  axisWidthPx: number,
  railX: number,
  tickX: number,
): readonly string[] {
  const textX = (axisWidthPx + tickX - railX) / 2;
  const availableTextWidthPx = axisWidthPx - 4;
  const estimatedTextWidthPx = tick.label.length * axisFontSizePx * 0.6;
  const textLengthAttributes =
    estimatedTextWidthPx > availableTextWidthPx && availableTextWidthPx > 0
      ? ([
          ["textLength", formatNumber(availableTextWidthPx)],
          ["lengthAdjust", "spacingAndGlyphs"],
        ] as const)
      : [];

  return [
    `      ${tag("line", [
      ["data-kind", tick.kind],
      ["data-time-ms", String(tick.timeMs)],
      ["x1", formatNumber(railX)],
      ["y1", formatNumber(tick.y)],
      ["x2", formatNumber(tickX)],
      ["y2", formatNumber(tick.y)],
      ["stroke", axisStroke],
      ["stroke-width", "1"],
    ])}`,
    `      ${tag(
      "text",
      [
        ["data-kind", tick.kind],
        ["data-time-ms", String(tick.timeMs)],
        ["x", formatNumber(textX)],
        ["y", formatNumber(tick.y)],
        ["fill", axisText],
        ["font-family", "monospace"],
        ["font-size", String(axisFontSizePx)],
        ["text-anchor", "middle"],
        ["dominant-baseline", "middle"],
        ...textLengthAttributes,
      ],
      false,
    )}${escapeText(tick.label)}</text>`,
  ];
}

function panelPrefix(panel: RenderPanel): string {
  return `panel-${String(panel.index).padStart(4, "0")}`;
}
