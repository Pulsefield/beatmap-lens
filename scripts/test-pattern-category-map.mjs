#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPatternCategoryMap } from "./build-pattern-category-map.mjs";

const corpusRoot = await mkdtemp(join(tmpdir(), "beatmap-lens-pattern-map-"));
const catalogCsv = `Map,Version,Category,Difficulty,Mapper,Artist,Link
First,One,Light Jumpsteam & Burst,EX 1,Mapper,Artist,https://osu.ppy.sh/beatmapsets/10#mania/101
Second,Two,"Jumpstream, Trill",EX 2,Mapper,Artist,https://osu.ppy.sh/beatmaps/102
Missing,Three,Jack,EX 3,Mapper,Artist,https://osu.ppy.sh/beatmaps/103
Unlinked,Four,Roll,EX 4,Mapper,Artist,
`;

try {
  const firstPath = join(corpusRoot, "first.osu");
  const duplicatePath = join(corpusRoot, "first-local-variant.osu");
  const wrongKeyModePath = join(corpusRoot, "first-7k.osu");

  await Promise.all([
    writeFile(firstPath, beatmapSource({ beatmapId: 101, keyCount: 4 })),
    writeFile(duplicatePath, beatmapSource({ beatmapId: 101, keyCount: 4 })),
    writeFile(wrongKeyModePath, beatmapSource({ beatmapId: 101, keyCount: 7 })),
  ]);

  const mapping = await buildPatternCategoryMap(corpusRoot, catalogCsv, "fixture.csv");
  const matchedPaths = Object.keys(mapping.pathCategories);

  assertEqual(mapping.catalog.rowCount, 4, "catalog.rowCount");
  assertEqual(mapping.catalog.linkedRowCount, 3, "catalog.linkedRowCount");
  assertEqual(mapping.catalog.uniqueBeatmapIds, 3, "catalog.uniqueBeatmapIds");
  assertEqual(mapping.corpus.osuFileCount, 3, "corpus.osuFileCount");
  assertEqual(mapping.corpus.mania4KFileCount, 2, "corpus.mania4KFileCount");
  assertEqual(mapping.summary.matchedFiles, 2, "summary.matchedFiles");
  assertEqual(mapping.summary.matchedBeatmapIds, 1, "summary.matchedBeatmapIds");
  assertEqual(matchedPaths.length, 2, "pathCategories size");
  assertDeepEqual(mapping.pathCategories[firstPath], ["burst", "light-jumpstream"]);
  assertDeepEqual(mapping.pathCategories[duplicatePath], ["burst", "light-jumpstream"]);
  if (mapping.pathCategories[wrongKeyModePath]) {
    throw new Error("Expected the 7K local variant to be excluded.");
  }
} finally {
  await rm(corpusRoot, { recursive: true, force: true });
}

console.log("Pattern category map smoke tests passed.");

function beatmapSource({ beatmapId, keyCount }) {
  return `osu file format v14

[General]
Mode:3

[Metadata]
BeatmapID:${beatmapId}

[Difficulty]
CircleSize:${keyCount}

[HitObjects]
64,192,500,1,0,0:0:0:0:
`;
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`Expected ${name} to be ${expected}, received ${actual}.`);
  }
}

function assertDeepEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}
