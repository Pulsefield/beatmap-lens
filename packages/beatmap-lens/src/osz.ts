import {
  AsyncUnzipInflate,
  strFromU8,
  Unzip,
  type UnzipFile,
  type UnzipFileInfo,
  unzipSync,
} from "fflate";
import { connectBeatmapAudio, parseBeatmap } from "./beatmap.js";
import type { Beatmap, BeatmapAudio, BeatmapSet, ParseOszOptions } from "./types.js";

interface ArchiveEntry {
  readonly archiveName: string;
  readonly path: string;
  readonly originalSize: number;
}

interface ArchiveIndex {
  readonly entries: readonly ArchiveEntry[];
  readonly entriesByPath: ReadonlyMap<string, ArchiveEntry>;
  readonly entriesByFoldedPath: ReadonlyMap<string, ArchiveEntry | null>;
}

interface InflateBudget {
  readonly maximum: number;
  used: number;
}

interface LoadSettings {
  readonly maxInflatedBytes: number;
  readonly maxConcurrency: number;
}

interface LoadJob {
  readonly file: UnzipFile;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (error: unknown) => void;
}

type ConcurrentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

export const DEFAULT_OSZ_MAX_INFLATED_BYTES = 256 * 1024 * 1024;
export const DEFAULT_OSZ_MAX_CONCURRENCY = 2;

const maximumOszConcurrency = 8;

export async function parseOsz(
  bytes: Uint8Array,
  options: ParseOszOptions = {},
): Promise<BeatmapSet> {
  const beatmaps: Beatmap[] = [];
  const audioByPath = new Map<string, BeatmapAudio>();

  for await (const beatmap of iterateOsz(bytes, options)) {
    beatmaps.push(beatmap);
    if (beatmap.audio) audioByPath.set(beatmap.audio.filename, beatmap.audio);
  }

  const audios = [...audioByPath.values()].sort((left, right) =>
    compareText(left.filename, right.filename),
  );
  return { beatmaps, audios };
}

export async function* iterateOsz(
  bytes: Uint8Array,
  options: ParseOszOptions = {},
): AsyncGenerator<Beatmap> {
  const settings = resolveLoadSettings(options);
  const archive = indexArchive(bytes);
  const osuEntries = archive.entries
    .filter((entry) => hasExtension(entry.path, "osu"))
    .sort((left, right) => compareText(left.path, right.path));
  const budget: InflateBudget = { maximum: settings.maxInflatedBytes, used: 0 };

  reserveEntries(osuEntries, budget);

  const loader = new ArchiveLoader(bytes, settings.maxConcurrency, settings.maxInflatedBytes);
  try {
    const beatmaps: Beatmap[] = [];
    for await (const beatmap of mapConcurrent(
      osuEntries,
      settings.maxConcurrency,
      async (entry) => {
        const contents = await loader.load(entry);
        return parseBeatmap(strFromU8(contents), { filename: entry.path });
      },
    )) {
      if (isSupportedBeatmap(beatmap)) beatmaps.push(beatmap);
    }

    const audioLoads = new Map<string, Promise<BeatmapAudio>>();
    const loadAudio = (beatmap: Beatmap): Promise<BeatmapAudio | undefined> => {
      if (!beatmap.audioFilename) return Promise.resolve(undefined);

      const audioPath = resolveArchivePath(beatmap.osuFilename ?? "", beatmap.audioFilename);
      const entry = findArchiveEntry(archive, audioPath);
      if (!entry) return Promise.resolve(undefined);

      const existing = audioLoads.get(entry.path);
      if (existing) return existing;

      reserveEntry(entry, budget);
      const promise = loader.load(entry).then((audioBytes): BeatmapAudio => {
        const mimeType = audioMimeType(entry.path);
        return {
          filename: entry.path,
          bytes: audioBytes,
          ...(mimeType ? { mimeType } : {}),
        };
      });
      audioLoads.set(entry.path, promise);
      return promise;
    };

    for await (const beatmap of mapConcurrent(
      beatmaps,
      settings.maxConcurrency,
      async (beatmap) => {
        const audio = await loadAudio(beatmap);
        return audio ? connectBeatmapAudio(beatmap, audio) : beatmap;
      },
    )) {
      yield beatmap;
    }
  } finally {
    loader.close();
  }
}

class ArchiveLoader {
  readonly #files = new Map<string, UnzipFile>();
  readonly #queue: LoadJob[] = [];
  readonly #activeFiles = new Set<UnzipFile>();
  readonly #sourceBuffer: ArrayBufferLike;
  #activeCount = 0;
  #closed = false;
  #inflatedBytes = 0;

  constructor(
    bytes: Uint8Array,
    readonly maxConcurrency: number,
    readonly maxInflatedBytes: number,
  ) {
    this.#sourceBuffer = bytes.buffer;
    const unzip = new Unzip((file) => this.#files.set(file.name, file));
    unzip.register(AsyncUnzipInflate);
    unzip.push(bytes, true);
  }

  load(entry: ArchiveEntry): Promise<Uint8Array> {
    const file = this.#files.get(entry.archiveName);
    if (!file) return Promise.reject(new Error(`Missing archive entry: ${entry.path}`));
    if (this.#closed) return Promise.reject(new Error("Osz loading has stopped."));

    return new Promise((resolve, reject) => {
      this.#queue.push({ file, resolve, reject });
      this.#pump();
    });
  }

  close(): void {
    this.#closed = true;
    this.#queue.length = 0;
    for (const file of this.#activeFiles) file.terminate();
    this.#activeFiles.clear();
  }

  #pump(): void {
    while (!this.#closed && this.#activeCount < this.maxConcurrency) {
      const job = this.#queue.shift();
      if (!job) return;
      this.#start(job);
    }
  }

  #start(job: LoadJob): void {
    const chunks: Uint8Array[] = [];
    let finished = false;

    this.#activeCount += 1;
    this.#activeFiles.add(job.file);

    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.#activeCount -= 1;
      this.#activeFiles.delete(job.file);
      this.#pump();
    };

    job.file.ondata = (error, data, final) => {
      if (finished) return;
      if (error) {
        finish();
        job.reject(error);
        return;
      }
      if (data?.length) {
        const nextInflatedBytes = this.#inflatedBytes + data.length;
        if (nextInflatedBytes > this.maxInflatedBytes) {
          job.file.terminate();
          finish();
          job.reject(
            new RangeError(`Osz extraction exceeds maxInflatedBytes (${this.maxInflatedBytes}).`),
          );
          return;
        }
        this.#inflatedBytes = nextInflatedBytes;
        chunks.push(data);
      }
      if (!final) return;

      finish();
      job.resolve(joinChunks(chunks, this.#sourceBuffer));
    };

    try {
      job.file.start();
    } catch (error) {
      finish();
      job.reject(error);
    }
  }
}

async function* mapConcurrent<Input, Output>(
  inputs: readonly Input[],
  maxConcurrency: number,
  transform: (input: Input) => Promise<Output>,
): AsyncGenerator<Output> {
  const running: Promise<ConcurrentResult<Output>>[] = [];
  let nextIndex = 0;

  const fill = (): void => {
    while (running.length < maxConcurrency && nextIndex < inputs.length) {
      const input = inputs[nextIndex];
      nextIndex += 1;
      running.push(
        Promise.resolve()
          .then(() => transform(input as Input))
          .then(
            (value): ConcurrentResult<Output> => ({ ok: true, value }),
            (error): ConcurrentResult<Output> => ({ ok: false, error }),
          ),
      );
    }
  };

  fill();
  while (running.length > 0) {
    const result = await running.shift();
    if (!result) return;
    if (!result.ok) throw result.error;
    fill();
    yield result.value;
  }
}

function indexArchive(bytes: Uint8Array): ArchiveIndex {
  const indexedEntries: Array<{
    readonly archiveName: string;
    readonly normalizedName: string;
    readonly originalSize: number;
  }> = [];

  unzipSync(bytes, {
    filter: (entry: UnzipFileInfo) => {
      if (!isDirectory(entry.name)) {
        indexedEntries.push({
          archiveName: entry.name,
          normalizedName: normalizePath(entry.name),
          originalSize: entry.originalSize,
        });
      }
      return false;
    },
  });

  const commonRoot = findCommonRoot(indexedEntries.map((entry) => entry.normalizedName));
  const entries = indexedEntries.map(
    (entry): ArchiveEntry => ({
      archiveName: entry.archiveName,
      path: stripCommonRoot(entry.normalizedName, commonRoot),
      originalSize: entry.originalSize,
    }),
  );
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const entriesByFoldedPath = new Map<string, ArchiveEntry | null>();

  for (const entry of entries) {
    const foldedPath = foldPath(entry.path);
    const previous = entriesByFoldedPath.get(foldedPath);
    if (previous === undefined) entriesByFoldedPath.set(foldedPath, entry);
    else if (previous?.path !== entry.path) entriesByFoldedPath.set(foldedPath, null);
  }

  return { entries, entriesByPath, entriesByFoldedPath };
}

function findArchiveEntry(archive: ArchiveIndex, path: string): ArchiveEntry | undefined {
  return (
    archive.entriesByPath.get(path) ?? archive.entriesByFoldedPath.get(foldPath(path)) ?? undefined
  );
}

function resolveLoadSettings(options: ParseOszOptions): LoadSettings {
  const maxInflatedBytes = options.maxInflatedBytes ?? DEFAULT_OSZ_MAX_INFLATED_BYTES;
  if (!Number.isFinite(maxInflatedBytes) || maxInflatedBytes < 0) {
    throw new RangeError("maxInflatedBytes must be a finite non-negative number.");
  }

  const maxConcurrency = options.maxConcurrency ?? DEFAULT_OSZ_MAX_CONCURRENCY;
  if (
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > maximumOszConcurrency
  ) {
    throw new RangeError(`maxConcurrency must be an integer from 1 to ${maximumOszConcurrency}.`);
  }

  return { maxInflatedBytes, maxConcurrency };
}

function reserveEntries(entries: readonly ArchiveEntry[], budget: InflateBudget): void {
  for (const entry of entries) reserveEntry(entry, budget);
}

function reserveEntry(entry: ArchiveEntry, budget: InflateBudget): void {
  const nextUsed = budget.used + entry.originalSize;
  if (nextUsed > budget.maximum) {
    throw new RangeError(`Osz extraction exceeds maxInflatedBytes (${budget.maximum}).`);
  }
  budget.used = nextUsed;
}

function joinChunks(chunks: readonly Uint8Array[], sourceBuffer: ArrayBufferLike): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) {
    const chunk = chunks[0] as Uint8Array;
    return chunk.buffer === sourceBuffer ? new Uint8Array(chunk) : chunk;
  }

  const joined = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function findCommonRoot(paths: readonly string[]): string {
  const files = paths.filter((path) => path && !path.endsWith("/"));
  const first = files[0]?.split("/") ?? [];
  const maximumLength = Math.max(first.length - 1, 0);
  let length = 0;

  while (
    length < maximumLength &&
    files.every((path) => path.split("/")[length] === first[length])
  ) {
    length += 1;
  }

  return first.slice(0, length).join("/");
}

function stripCommonRoot(path: string, commonRoot: string): string {
  return commonRoot && path.startsWith(`${commonRoot}/`) ? path.slice(commonRoot.length + 1) : path;
}

function resolveArchivePath(osuFilename: string, audioFilename: string): string {
  const directory = normalizePath(osuFilename).split("/").slice(0, -1);
  return normalizePath([...directory, audioFilename].join("/"));
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function foldPath(path: string): string {
  return path.toLowerCase();
}

function isSupportedBeatmap(beatmap: Beatmap): boolean {
  return (
    beatmap.chart.mode === 3 &&
    Number.isInteger(beatmap.chart.keyCount) &&
    beatmap.chart.keyCount >= 4 &&
    beatmap.chart.keyCount <= 10
  );
}

function hasExtension(filename: string, extension: string): boolean {
  return extensionOf(filename) === extension;
}

function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isDirectory(filename: string): boolean {
  return filename.endsWith("/") || filename.endsWith("\\");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function audioMimeType(filename: string): string | undefined {
  const extension = extensionOf(filename);
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "wav") return "audio/wav";
  return undefined;
}
