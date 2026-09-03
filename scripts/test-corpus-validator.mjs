#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const validatorPath = fileURLToPath(new URL("./validate-corpus.mjs", import.meta.url));
const missingCorpusPath = resolve(".corpus-that-does-not-exist");
const result = spawnSync(process.execPath, [validatorPath, missingCorpusPath], {
  encoding: "utf8",
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status === 0) {
  throw new Error("Expected corpus validation to fail for a missing directory.");
}
if (output.includes(missingCorpusPath)) {
  throw new Error("Corpus validation exposed the absolute corpus path.");
}
if (!output.includes("Corpus validation could not start")) {
  throw new Error("Corpus validation did not emit the expected redacted failure.");
}

const corpusRoot = await mkdtemp(join(tmpdir(), "beatmap-lens-corpus-validator-"));

try {
  await writeFile(join(corpusRoot, "supported-7k.osu"), beatmapSource({ circleSize: 7 }));

  const summaryResult = spawnSync(process.execPath, [validatorPath, corpusRoot], {
    encoding: "utf8",
  });
  const summaryOutput = `${summaryResult.stdout ?? ""}${summaryResult.stderr ?? ""}`;

  if (summaryResult.status !== 0) {
    throw new Error("Expected corpus validation to pass for the generated summary corpus.");
  }
  if (summaryOutput.includes(corpusRoot) || summaryOutput.includes("supported-7k.osu")) {
    throw new Error("Corpus validation exposed corpus file system details.");
  }

  const summary = JSON.parse(summaryResult.stdout);
  assertEqual(summary.processedBeatmaps, 1, "processedBeatmaps");
  assertEqual(summary.supportedKeyModeBeatmaps, 1, "supportedKeyModeBeatmaps");
  assertEqual(summary.maniaKeyModeBeatmaps["7K"], 1, "maniaKeyModeBeatmaps.7K");
  assertEqual(summary.renderedBeatmaps, 1, "renderedBeatmaps");
  assertEqual(summary.failureCount, 0, "failureCount");
} finally {
  await rm(corpusRoot, { recursive: true, force: true });
}

console.log("Corpus validator smoke tests passed.");

function beatmapSource({ circleSize }) {
  return `osu file format v14

[General]
Mode:3

[Metadata]
Title:Corpus Validator ${circleSize}K
Artist:Beatmap Lens
Creator:Beatmap Lens
Version:Smoke

[Difficulty]
CircleSize:${circleSize}

[HitObjects]
64,192,500,1,0,0:0:0:0:
448,192,30000,128,0,45000:0:0:0:0:
`;
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`Expected ${name} to be ${expected}, received ${actual}.`);
  }
}
