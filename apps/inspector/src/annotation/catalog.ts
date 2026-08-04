export interface CatalogTask {
  categories: readonly string[];
  pathSegments: readonly string[];
}

export interface CatalogSource {
  categories: readonly string[];
  sha256: string;
  source: string;
  tasks: readonly CatalogTask[];
}

export interface ReadableFile {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface ReadableFileHandle {
  readonly kind: "file";
  getFile(): Promise<ReadableFile>;
}

export interface ReadableDirectoryHandle {
  readonly kind: "directory";
  getDirectoryHandle(name: string): Promise<ReadableDirectoryHandle>;
  getFileHandle(name: string): Promise<ReadableFileHandle>;
}

export function parseCatalogManifest(source: string): CatalogSource {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || value.version !== 1) {
    throw new TypeError("Unsupported catalog manifest.");
  }

  const catalog = value.catalog;
  const corpus = value.corpus;
  const pathCategories = value.pathCategories;
  if (
    !isRecord(catalog) ||
    typeof catalog.source !== "string" ||
    !isSha256(catalog.sha256) ||
    !isStringArray(catalog.categoryEnum) ||
    !isRecord(corpus) ||
    typeof corpus.root !== "string" ||
    corpus.root.length === 0 ||
    !isRecord(pathCategories)
  ) {
    throw new TypeError("Invalid catalog manifest.");
  }

  const root = normalizePath(corpus.root).replace(/\/$/, "");
  const tasks = Object.entries(pathCategories).map(([mappedPath, categories]) => ({
    categories: parseCategories(categories),
    pathSegments: relativeSegments(root, mappedPath),
  }));

  tasks.sort((left, right) =>
    left.pathSegments.join("/").localeCompare(right.pathSegments.join("/")),
  );

  return {
    categories: [...catalog.categoryEnum],
    sha256: catalog.sha256,
    source: catalog.source,
    tasks,
  };
}

export async function readCatalogTask(
  corpus: ReadableDirectoryHandle,
  task: CatalogTask,
): Promise<ReadableFile> {
  if (task.pathSegments.length === 0) {
    throw new TypeError("Catalog task must point to a file.");
  }

  let directory = corpus;
  for (const segment of task.pathSegments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment);
  }

  const filename = task.pathSegments.at(-1);
  if (!filename) {
    throw new TypeError("Catalog task must point to a file.");
  }
  return (await directory.getFileHandle(filename)).getFile();
}

function relativeSegments(root: string, mappedPath: string): readonly string[] {
  const normalized = normalizePath(mappedPath);
  const prefix = `${root}/`;
  if (!normalized.startsWith(prefix)) {
    throw new TypeError("Catalog path is outside its corpus root.");
  }

  const segments = normalized.slice(prefix.length).split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Catalog path is not a resolvable corpus-relative path.");
  }
  return segments;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function parseCategories(value: unknown): readonly string[] {
  if (!isStringArray(value)) {
    throw new TypeError("Catalog task categories must be strings.");
  }
  return [...new Set(value)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{64}$/.test(value);
}
