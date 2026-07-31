#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { parseOsu, renderSvg, toManiaChart } from "../packages/beatmap-lens/dist/index.js";

const { rootArgument, sampleSize } = parseArguments(process.argv.slice(2));

if (!rootArgument) {
  console.error("Usage: pnpm validate:corpus -- <beatmap-directory> [--sample <positive-integer>]");
  process.exitCode = 2;
} else {
  try {
    await validateCorpus(rootArgument, sampleSize);
  } catch (error) {
    console.error(formatRootFailure(error));
    process.exitCode = 1;
  }
}

async function validateCorpus(rootArgumentValue, requestedSampleSize) {
  const root = resolve(rootArgumentValue);
  const rootStats = await stat(root);

  if (!rootStats.isDirectory()) {
    throw new TypeError("The supplied corpus path is not a directory.");
  }

  const discoveredFiles = await findBeatmaps(root);
  const selectedFiles = selectDeterministicSample(discoveredFiles, root, requestedSampleSize);
  const startedAt = performance.now();
  const diagnosticCounts = new Map();
  const failures = [];
  const summary = {
    discoveredBeatmaps: discoveredFiles.length,
    processedBeatmaps: 0,
    mania4kBeatmaps: 0,
    otherKeyModeBeatmaps: 0,
    nonManiaBeatmaps: 0,
    unknownModeBeatmaps: 0,
    sourceHitObjects: 0,
    normalizedNotes: 0,
    renderedBeatmaps: 0,
  };

  for (const path of selectedFiles) {
    try {
      const source = await readFile(path, "utf8");
      const document = parseOsu(source);
      const chart = toManiaChart(document);

      summary.processedBeatmaps += 1;
      summary.sourceHitObjects += document.hitObjects.length;
      summary.normalizedNotes += chart.notes.length;

      if (chart.mode === 3 && chart.sourceKeyCount === 4) {
        summary.mania4kBeatmaps += 1;
      } else if (chart.mode === 3) {
        summary.otherKeyModeBeatmaps += 1;
      } else if (chart.mode === undefined) {
        summary.unknownModeBeatmaps += 1;
      } else {
        summary.nonManiaBeatmaps += 1;
      }

      for (const diagnostic of chart.diagnostics) {
        diagnosticCounts.set(diagnostic.code, (diagnosticCounts.get(diagnostic.code) ?? 0) + 1);
      }

      const invariantFailure = checkChartInvariants(chart);
      if (invariantFailure) {
        failures.push({
          fileId: pathId(root, path),
          stage: "invariant",
          message: invariantFailure,
        });
        continue;
      }

      const svg = renderSvg(chart, {
        startTime: 0,
        endTime: 15_000,
        width: 640,
        pixelsPerSecond: 40,
      });
      if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) {
        failures.push({
          fileId: pathId(root, path),
          stage: "render",
          message: "SVG output does not start with the expected root element.",
        });
        continue;
      }
      summary.renderedBeatmaps += 1;
    } catch (error) {
      failures.push({
        fileId: pathId(root, path),
        stage: "pipeline",
        message: formatPipelineFailure(error, root, path),
      });
    }
  }

  const result = {
    ...summary,
    sample: requestedSampleSize
      ? {
          strategy: "sha256-of-seed-and-relative-path",
          requested: requestedSampleSize,
        }
      : { strategy: "full-corpus" },
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    diagnostics: Object.fromEntries(
      [...diagnosticCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    failureCount: failures.length,
    failures: failures.slice(0, 20),
  };

  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function findBeatmaps(root) {
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

function selectDeterministicSample(files, root, requestedSampleSize) {
  if (!requestedSampleSize || requestedSampleSize >= files.length) {
    return files;
  }

  return files
    .map((path) => ({
      path,
      score: createHash("sha256")
        .update("beatmap-lens-corpus-v1\0")
        .update(relative(root, path))
        .digest("hex"),
    }))
    .sort((left, right) => left.score.localeCompare(right.score))
    .slice(0, requestedSampleSize)
    .map(({ path }) => path)
    .sort((left, right) => left.localeCompare(right));
}

function pathId(root, path) {
  return createHash("sha256")
    .update("beatmap-lens-corpus-file-v1\0")
    .update(relative(root, path))
    .digest("hex")
    .slice(0, 12);
}

function formatRootFailure(error) {
  const code = errorCode(error);
  const detail = code ? ` (${code})` : "";
  return `Corpus validation could not start${detail}. Check that the supplied directory exists and is readable.`;
}

function formatPipelineFailure(error, root, path) {
  const code = errorCode(error);
  if (code) {
    return `Unable to process beatmap (${code}).`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return redactKnownPaths(message, [path, root]);
}

function errorCode(error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function redactKnownPaths(message, paths) {
  return paths.reduce(
    (redacted, path, index) =>
      path.length > 0
        ? redacted.split(path).join(index === 0 ? "<beatmap>" : "<corpus-root>")
        : redacted,
    message,
  );
}

function parseArguments(argumentsValue) {
  let rootArgumentValue;
  let requestedSampleSize;

  for (let index = 0; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--sample") {
      if (requestedSampleSize !== undefined) {
        throw new TypeError("--sample may only be specified once.");
      }
      requestedSampleSize = parsePositiveInteger(argumentsValue[index + 1], "--sample");
      index += 1;
    } else if (argument?.startsWith("--")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else if (argument) {
      if (rootArgumentValue !== undefined) {
        throw new TypeError("Only one corpus directory may be provided.");
      }
      rootArgumentValue = argument;
    }
  }

  return {
    rootArgument: rootArgumentValue,
    sampleSize: requestedSampleSize,
  };
}

function parsePositiveInteger(rawValue, name) {
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== rawValue) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function checkChartInvariants(chart) {
  const seenIds = new Set();
  let previousNote;

  for (const note of chart.notes) {
    if (!Number.isFinite(note.startTime) || !Number.isFinite(note.endTime)) {
      return `Note ${note.id} has a non-finite time.`;
    }
    if (!Number.isInteger(note.column) || note.column < 0 || note.column >= chart.keyCount) {
      return `Note ${note.id} has an invalid column.`;
    }
    if (note.endTime < note.startTime) {
      return `Note ${note.id} ends before it starts.`;
    }
    if (note.kind === "long" && note.endTime === note.startTime) {
      return `Long note ${note.id} has zero duration.`;
    }
    if (seenIds.has(note.id)) {
      return `Note id ${note.id} is duplicated.`;
    }
    if (previousNote && compareNotes(previousNote, note) > 0) {
      return `Note ${note.id} is out of deterministic order.`;
    }

    seenIds.add(note.id);
    previousNote = note;
  }

  return undefined;
}

function compareNotes(left, right) {
  return (
    left.startTime - right.startTime ||
    left.endTime - right.endTime ||
    left.column - right.column ||
    left.sourceLine - right.sourceLine ||
    left.kind.localeCompare(right.kind)
  );
}
