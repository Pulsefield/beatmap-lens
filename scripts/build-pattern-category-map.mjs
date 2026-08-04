#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultCatalogSource =
  "https://docs.google.com/spreadsheets/d/1KVJUXHydvdSsbhxMYq9dCrIXr7D2QwjRGMuIOjJjWbc/edit";
const defaultCatalogUrl =
  "https://docs.google.com/spreadsheets/d/1KVJUXHydvdSsbhxMYq9dCrIXr7D2QwjRGMuIOjJjWbc/export?format=csv";
const defaultOutputPath = ".local/beatmap-pattern-categories.json";

export const communityPatternCategories = [
  "alternation",
  "bias",
  "burst",
  "chord",
  "chordjack",
  "chordstream",
  "classic-jumpstream",
  "dump",
  "dumpstream",
  "glut",
  "handstream",
  "handtrill",
  "hand-trillstream",
  "inverse",
  "jack",
  "jackstream",
  "jump",
  "jump-burst",
  "jump-jackstream",
  "jump-minijack",
  "jump-polystream",
  "jump-rollstream",
  "jumpstream",
  "jump-trillstream",
  "light-glut",
  "light-handstream",
  "light-jump-rollstream",
  "light-jumpstream",
  "light-ln",
  "light-slowjam",
  "light-stream",
  "ln",
  "ln-jumpstream",
  "ln-rice",
  "ln-stream",
  "longjack",
  "midjack",
  "minijack",
  "poly",
  "quad",
  "quadjack",
  "rhythm",
  "roll",
  "rollstream",
  "shift",
  "slowjam",
  "speedstream",
  "stamina",
  "stream",
  "sv-glitch",
  "sv-memory",
  "technical",
  "trill",
  "trillstream",
  "vibro",
];

const categorySet = new Set(communityPatternCategories);
const categoryCorrections = new Map([
  ["Glitch SV", ["sv-glitch"]],
  ["Jumpstream, Trill", ["jumpstream", "trill"]],
  ["Light Jumpsteam", ["light-jumpstream"]],
  ["Long Jack", ["longjack"]],
  ["Minjack", ["minijack"]],
  ["Speedstreem", ["speedstream"]],
  ["SV Glitch", ["sv-glitch"]],
]);

const isMain = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);

if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const catalogCsv = await readCatalog(options.catalog);
    const mapping = await buildPatternCategoryMap(options.corpus, catalogCsv, defaultCatalogSource);

    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(mapping, null, 2)}\n`);

    console.log(
      JSON.stringify(
        {
          output: options.output,
          ...mapping.summary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function buildPatternCategoryMap(corpusArgument, catalogCsv, catalogSource) {
  const corpusRoot = resolve(corpusArgument);
  const catalog = parseCatalog(catalogCsv);
  const osuFiles = await findOsuFiles(corpusRoot);
  const matchedPaths = new Map();
  const matchedBeatmapIds = new Set();
  let mania4KFileCount = 0;

  for (let start = 0; start < osuFiles.length; start += 64) {
    const batch = osuFiles.slice(start, start + 64);
    const metadata = await Promise.all(batch.map((path) => readBeatmapMetadata(path)));

    for (let index = 0; index < batch.length; index += 1) {
      const beatmap = metadata[index];
      if (beatmap.mode !== 3 || beatmap.keyCount !== 4) {
        continue;
      }

      mania4KFileCount += 1;
      const categories = catalog.categoriesByBeatmapId.get(beatmap.beatmapId);
      if (!categories) {
        continue;
      }

      matchedBeatmapIds.add(beatmap.beatmapId);
      matchedPaths.set(batch[index], [...categories].sort());
    }
  }

  const pathCategories = Object.fromEntries(
    [...matchedPaths.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    version: 1,
    catalog: {
      source: catalogSource,
      sha256: createHash("sha256").update(catalogCsv).digest("hex"),
      rowCount: catalog.rowCount,
      linkedRowCount: catalog.linkedRowCount,
      uniqueBeatmapIds: catalog.categoriesByBeatmapId.size,
      categoryEnum: communityPatternCategories,
    },
    corpus: {
      root: corpusRoot,
      osuFileCount: osuFiles.length,
      mania4KFileCount,
    },
    summary: {
      matchedFiles: matchedPaths.size,
      matchedBeatmapIds: matchedBeatmapIds.size,
      unmatchedBeatmapIds: catalog.categoriesByBeatmapId.size - matchedBeatmapIds.size,
      unlinkedCatalogRows: catalog.rowCount - catalog.linkedRowCount,
    },
    pathCategories,
  };
}

export function parseCatalog(csvSource) {
  const rows = parseCsv(csvSource);
  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, "")) ?? [];
  const categoryIndex = headers.indexOf("Category");
  const linkIndex = headers.indexOf("Link");

  if (categoryIndex < 0 || linkIndex < 0) {
    throw new TypeError("Catalog CSV must contain Category and Link columns.");
  }

  const categoriesByBeatmapId = new Map();
  let linkedRowCount = 0;

  for (const row of rows) {
    const category = row[categoryIndex]?.trim();
    const beatmapId = parseBeatmapId(row[linkIndex]);
    if (!category || !beatmapId) {
      continue;
    }

    linkedRowCount += 1;
    const categories = categoriesByBeatmapId.get(beatmapId) ?? new Set();
    for (const value of normalizeCategories(category)) {
      categories.add(value);
    }
    categoriesByBeatmapId.set(beatmapId, categories);
  }

  return {
    rowCount: rows.length,
    linkedRowCount,
    categoriesByBeatmapId,
  };
}

function normalizeCategories(category) {
  const categories = category.split("&").flatMap((token) => normalizeCategoryToken(token.trim()));

  for (const value of categories) {
    if (!categorySet.has(value)) {
      throw new TypeError(`Unknown community pattern category: ${value}`);
    }
  }

  return categories;
}

function normalizeCategoryToken(token) {
  const corrected = categoryCorrections.get(token);
  if (corrected) {
    return corrected;
  }

  return [
    token
      .toLowerCase()
      .replaceAll("/", "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  ];
}

function parseBeatmapId(link = "") {
  const match = link.match(/(?:#mania\/|\/beatmaps\/|\/b\/)(\d+)/);
  return match ? Number(match[1]) : undefined;
}

async function readBeatmapMetadata(path) {
  const source = await readFile(path, "utf8");
  return {
    mode: readNumberProperty(source, "Mode"),
    keyCount: readNumberProperty(source, "CircleSize"),
    beatmapId: readNumberProperty(source, "BeatmapID"),
  };
}

function readNumberProperty(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`, "m"));
  return match ? Number(match[1]) : undefined;
}

async function findOsuFiles(root) {
  const files = [];
  const directories = [root];

  while (directories.length > 0) {
    const directory = directories.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".osu") {
        files.push(path);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function readCatalog(source) {
  if (/^https?:\/\//.test(source)) {
    const { stdout } = await execFileAsync(
      "curl",
      ["--fail", "--location", "--silent", "--show-error", source],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  }

  return readFile(resolve(source), "utf8");
}

function parseArguments(argumentsValue) {
  let corpus;
  let catalog = defaultCatalogUrl;
  let output = resolve(defaultOutputPath);

  for (let index = 0; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--catalog") {
      index += 1;
      catalog = requireOptionValue(argumentsValue[index], "--catalog");
    } else if (argument === "--output") {
      index += 1;
      output = resolve(requireOptionValue(argumentsValue[index], "--output"));
    } else if (argument?.startsWith("--")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else if (argument) {
      if (corpus) {
        throw new TypeError("Only one corpus directory may be provided.");
      }
      corpus = argument;
    }
  }

  if (!corpus) {
    throw new TypeError(
      "Usage: pnpm catalog:map-local -- <beatmap-directory> [--catalog <csv-or-url>] [--output <json>]",
    );
  }

  return { corpus, catalog, output };
}

function requireOptionValue(value, name) {
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${name} requires a value.`);
  }
  return value;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}
