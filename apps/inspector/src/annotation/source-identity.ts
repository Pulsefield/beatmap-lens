import type { ManiaChart, ParsedOsu } from "beatmap-lens";
import { parseOsu, toManiaChart } from "beatmap-lens";
import { type Sha256DigestFunction, sha256Hex } from "./canonical-json";
import type { SourceIdentityV1 } from "./contracts";

export interface InspectedOsuSourceV1 {
  readonly text: string;
  readonly parsed: ParsedOsu;
  readonly chart: ManiaChart;
  readonly source: SourceIdentityV1;
}

const decoder = new TextDecoder("utf-8");

export function decodeOsuBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export async function inspectOsuSourceV1(
  bytes: Uint8Array,
  digest?: Sha256DigestFunction,
): Promise<InspectedOsuSourceV1> {
  const text = decodeOsuBytes(bytes);
  const parsed = parseOsu(text);
  const chart = toManiaChart(parsed);
  const source = await createSourceIdentityV1(bytes, parsed, chart, digest);
  return { text, parsed, chart, source };
}

export async function createSourceIdentityV1(
  bytes: Uint8Array,
  parsed: ParsedOsu,
  chart: ManiaChart,
  digest?: Sha256DigestFunction,
): Promise<SourceIdentityV1> {
  if (parsed.formatVersion === undefined) throw new Error("The .osu format version is required");

  const title = requiredMetadata(chart.metadata.title, "Title");
  const artist = requiredMetadata(chart.metadata.artist, "Artist");
  const creator = requiredMetadata(chart.metadata.creator, "Creator");
  const difficulty = requiredMetadata(chart.metadata.version, "Version");
  const beatmapId = integerProperty(parsed, "Metadata", "BeatmapID");
  const beatmapSetId = integerProperty(parsed, "Metadata", "BeatmapSetID");

  return {
    sha256: await sha256Hex(bytes, digest),
    byteLength: bytes.byteLength,
    osuFormatVersion: parsed.formatVersion,
    ...(beatmapId !== undefined ? { beatmapId } : {}),
    ...(beatmapSetId !== undefined ? { beatmapSetId } : {}),
    title,
    artist,
    creator,
    difficulty,
    keyCount: chart.keyCount,
    noteCount: chart.notes.length,
    normalizerId: "beatmap-lens-mania-v1",
  };
}

export const createSourceIdentity = createSourceIdentityV1;

export async function assertSourceBytesMatch(
  expected: Pick<SourceIdentityV1, "sha256" | "byteLength">,
  bytes: Uint8Array,
  digest?: Sha256DigestFunction,
): Promise<void> {
  if (bytes.byteLength !== expected.byteLength) {
    throw new Error(
      `Source byte length mismatch: expected ${expected.byteLength}, received ${bytes.byteLength}`,
    );
  }

  const actualSha256 = await sha256Hex(bytes, digest);
  if (actualSha256 !== expected.sha256) {
    throw new Error(
      `Source SHA-256 mismatch: expected ${expected.sha256}, received ${actualSha256}`,
    );
  }
}

function requiredMetadata(value: string | undefined, key: string): string {
  if (value === undefined || value.length === 0)
    throw new Error(`The .osu ${key} metadata is required`);
  return value;
}

function integerProperty(parsed: ParsedOsu, section: string, key: string): number | undefined {
  const value = [...parsed.properties]
    .reverse()
    .find(
      (property) =>
        property.section.toLowerCase() === section.toLowerCase() &&
        property.key.toLowerCase() === key.toLowerCase(),
    )?.value;
  if (value === undefined || value === "") return undefined;

  const integer = Number(value);
  return Number.isInteger(integer) ? integer : undefined;
}
