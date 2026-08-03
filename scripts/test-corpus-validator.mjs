#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
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

console.log("Corpus validator privacy smoke test passed.");
