import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { iterateOsz, parseOsz } from "../src/index";
import { DEFAULT_OSZ_MAX_CONCURRENCY, DEFAULT_OSZ_MAX_INFLATED_BYTES } from "../src/osz";

const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);

describe("parseOsz", () => {
  it("parses a beatmap set asynchronously and shares linked audio", async () => {
    let settled = false;
    const parsing = parseOsz(createBeatmapSetArchive()).then((beatmapSet) => {
      settled = true;
      return beatmapSet;
    });

    expect(settled).toBe(false);
    const beatmapSet = await parsing;

    expect(beatmapSet.beatmaps.map((beatmap) => beatmap.osuFilename)).toEqual([
      "Easy.osu",
      "Hard.osu",
    ]);
    expect(beatmapSet.beatmaps.map((beatmap) => beatmap.chart.keyCount)).toEqual([4, 7]);
    expect(beatmapSet.beatmaps.map((beatmap) => beatmap.chart.range)).toEqual([
      { startMs: 0, endMs: 501 },
      { startMs: 0, endMs: 501 },
    ]);
    expect(beatmapSet.audios).toHaveLength(1);
    expect(beatmapSet.audios[0]).toMatchObject({
      filename: "audio/song.mp3",
      mimeType: "audio/mpeg",
    });
    expect(beatmapSet.audios[0]?.bytes).toEqual(audioBytes);
    expect(beatmapSet.beatmaps[0]?.audio).toBe(beatmapSet.audios[0]);
    expect(beatmapSet.beatmaps[1]?.audio).toBe(beatmapSet.audios[0]);
  });

  it("iterates complete beatmaps with bounded concurrency", async () => {
    const beatmaps = [];
    for await (const beatmap of iterateOsz(createBeatmapSetArchive(), {
      maxConcurrency: 1,
    })) {
      beatmaps.push(beatmap);
    }

    expect(beatmaps.map((beatmap) => beatmap.osuFilename)).toEqual(["Easy.osu", "Hard.osu"]);
    expect(beatmaps[0]?.audio).toBeDefined();
    expect(beatmaps[0]?.audio).toBe(beatmaps[1]?.audio);
  });

  it("keeps a supported beatmap when its audio is absent", async () => {
    const archive = zipSync({
      "Missing.osu": strToU8(maniaSource("Missing", 4, "missing.mp3")),
    });
    const beatmapSet = await parseOsz(archive);

    expect(beatmapSet.beatmaps).toHaveLength(1);
    expect(beatmapSet.beatmaps[0]?.audioFilename).toBe("missing.mp3");
    expect(beatmapSet.beatmaps[0]?.audio).toBeUndefined();
    expect(beatmapSet.audios).toEqual([]);
  });

  it("connects audio through an unambiguous case-insensitive archive match", async () => {
    const archive = zipSync({
      "Case.osu": strToU8(maniaSource("Case", 4, "song.mp3")),
      "Song.mp3": audioBytes,
    });
    const beatmapSet = await parseOsz(archive);

    expect(beatmapSet.audios[0]?.filename).toBe("Song.mp3");
    expect(beatmapSet.beatmaps[0]?.audio).toBe(beatmapSet.audios[0]);
  });

  it("stops before selected archive contents exceed the configured byte budget", async () => {
    await expect(
      parseOsz(createBeatmapSetArchive(), { maxInflatedBytes: 128 }),
    ).rejects.toThrowError(/exceeds maxInflatedBytes/);
  });

  it("enforces the byte budget against actual inflated output", async () => {
    const archive = zipSync({
      "Actual.osu": strToU8(maniaSource("Actual", 4, "audio.mp3")),
      "audio.mp3": new Uint8Array(1_000),
    });
    const understatedArchive = understateCentralDirectorySizes(archive, 1);

    await expect(parseOsz(understatedArchive, { maxInflatedBytes: 2 })).rejects.toThrowError(
      /exceeds maxInflatedBytes/,
    );
  });

  it("detaches stored audio from the source archive buffer", async () => {
    const archive = zipSync(
      {
        "Stored.osu": strToU8(maniaSource("Stored", 4, "song.mp3")),
        "background.bin": new Uint8Array(1024 * 1024),
        "song.mp3": audioBytes,
      },
      { level: 0 },
    );
    const beatmapSet = await parseOsz(archive);

    expect(beatmapSet.audios[0]?.bytes).toEqual(audioBytes);
    expect(beatmapSet.audios[0]?.bytes.buffer).not.toBe(archive.buffer);
  });

  it("detaches stored audio when the archive is a Node buffer", async () => {
    const archive = nodeBufferFrom(
      zipSync(
        {
          "Stored.osu": strToU8(maniaSource("Stored", 4, "song.mp3")),
          "background.bin": new Uint8Array(1024 * 1024),
          "song.mp3": audioBytes,
        },
        { level: 0 },
      ),
    );
    const beatmapSet = await parseOsz(archive);

    expect(beatmapSet.audios[0]?.bytes).toEqual(audioBytes);
    expect(beatmapSet.audios[0]?.bytes.buffer).not.toBe(archive.buffer);
  });

  it("loads worker-sized compressed audio", async () => {
    const workerSizedAudio = createPseudoRandomBytes(400_000);
    const archive = zipSync({
      "Worker.osu": strToU8(maniaSource("Worker", 4, "worker.mp3")),
      "worker.mp3": workerSizedAudio,
    });
    const beatmapSet = await parseOsz(archive);

    expect(beatmapSet.audios[0]?.bytes).toEqual(workerSizedAudio);
    expect(beatmapSet.beatmaps[0]?.audio).toBe(beatmapSet.audios[0]);
  });

  it("can stop async iteration after a complete beatmap", async () => {
    const iterator = iterateOsz(createBeatmapSetArchive(), {
      maxConcurrency: 2,
    });

    expect((await iterator.next()).done).toBe(false);
    await expect(iterator.return(undefined)).resolves.toMatchObject({ done: true });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects the invalid inflated-byte budget %s",
    async (maxInflatedBytes) => {
      await expect(parseOsz(createBeatmapSetArchive(), { maxInflatedBytes })).rejects.toThrowError(
        /finite non-negative number/,
      );
    },
  );

  it.each([0, 9, 1.5])("rejects the invalid concurrency %s", async (maxConcurrency) => {
    await expect(parseOsz(createBeatmapSetArchive(), { maxConcurrency })).rejects.toThrowError(
      /integer from 1 to 8/,
    );
  });

  it("uses finite resource limits by default", () => {
    expect(DEFAULT_OSZ_MAX_INFLATED_BYTES).toBe(256 * 1024 * 1024);
    expect(DEFAULT_OSZ_MAX_CONCURRENCY).toBe(2);
  });
});

function createBeatmapSetArchive(): Uint8Array {
  return zipSync({
    "Set/Hard.osu": strToU8(maniaSource("Hard", 7, "audio\\song.mp3")),
    "Set/unused.ogg": new Uint8Array([9, 9, 9]),
    "Set/background.jpg": new Uint8Array(64 * 1024),
    "Set/audio/song.mp3": audioBytes,
    "Set/Easy.osu": strToU8(maniaSource("Easy", 4, "audio/song.mp3")),
    "Set/Standard.osu": strToU8(
      maniaSource("Standard", 4, "audio/song.mp3").replace("Mode:3", "Mode:0"),
    ),
  });
}

function maniaSource(version: string, keyCount: number, audioFilename: string): string {
  return `osu file format v14

[General]
AudioFilename:${audioFilename}
Mode:3

[Metadata]
Title:Archive Test
Artist:Beatmap Lens
Creator:Beatmap Lens
Version:${version}

[Difficulty]
CircleSize:${keyCount}

[HitObjects]
64,192,500,1,0,0:0:0:0:
`;
}

function understateCentralDirectorySizes(bytes: Uint8Array, size: number): Uint8Array {
  const result = bytes.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  for (let offset = 0; offset <= result.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 24, size, true);
  }

  return result;
}

function createPseudoRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state;
  }
  return bytes;
}

function nodeBufferFrom(bytes: Uint8Array): Uint8Array {
  const { Buffer } = globalThis as unknown as {
    readonly Buffer: { from(bytes: Uint8Array): Uint8Array };
  };
  return Buffer.from(bytes);
}
