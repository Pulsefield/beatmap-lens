import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/** Node adapter for the existing canonical command writer. Commits are atomic renames. */
export class LocalDirectoryHandle {
  kind = "directory";

  constructor(path) {
    this.path = resolve(path);
    this.name = basename(this.path);
  }

  async *entries() {
    const entries = await readdir(this.path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory())
        yield [entry.name, new LocalDirectoryHandle(join(this.path, entry.name))];
      if (entry.isFile()) yield [entry.name, new LocalFileHandle(join(this.path, entry.name))];
    }
  }

  async getDirectoryHandle(name, options = {}) {
    const path = child(this.path, name);
    if (options.create) await mkdir(path, { recursive: true });
    await exists(path, "directory");
    return new LocalDirectoryHandle(path);
  }

  async getFileHandle(name, options = {}) {
    const path = child(this.path, name);
    if (options.create) {
      try {
        await writeFile(path, "", { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    await exists(path, "file");
    return new LocalFileHandle(path);
  }
}

class LocalFileHandle {
  kind = "file";

  constructor(path) {
    this.path = path;
    this.name = basename(path);
  }

  async getFile() {
    const bytes = await readFile(this.path);
    return {
      text: async () => bytes.toString("utf8"),
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    };
  }

  async createWritable() {
    let content;
    return {
      write: async (data) => {
        content = data;
      },
      close: async () => {
        if (content === undefined) throw new Error("No canonical content was written.");
        await atomicWrite(this.path, content);
      },
    };
  }
}

export async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.pending`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

function child(parent, name) {
  if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new Error("Expected a single directory entry name.");
  }
  return join(parent, name);
}

async function exists(path, kind) {
  try {
    const entry = await stat(path);
    if (kind === "directory" ? !entry.isDirectory() : !entry.isFile()) {
      throw new Error(`Expected ${kind}: ${path}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new DOMException(`Entry not found: ${path}`, "NotFoundError");
  }
}
