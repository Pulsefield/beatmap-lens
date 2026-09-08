import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve, sep } from "node:path";

export async function resolveReviewAudio(dataset, source, filename) {
  if (!(source.beatmapSetId > 0) || !filename) return null;
  const relative = filename.replaceAll("\\", "/");
  if (isAbsolute(relative) || /^[a-z]:/i.test(relative) || relative.split("/").includes(".."))
    return null;
  try {
    const root = await realpath(dataset);
    const directory = join(root, "0", String(source.beatmapSetId));
    if ((await realpath(directory)) !== directory) return null;
    const path = await realpath(resolve(directory, relative));
    if (!path.startsWith(`${directory}${sep}`) || !(await stat(path)).isFile()) return null;
    return { path, filename };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "ELOOP") return null;
    throw error;
  }
}

/** Start the stream without awaiting its transfer, so the workflow writer stays available. */
export async function streamReviewAudio(request, response, audio) {
  const file = await open(audio.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const { size } = await file.stat();
  if (response.destroyed) {
    await file.close();
    return;
  }
  const mime = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
  };
  const headers = {
    "Content-Type": mime[extname(audio.filename).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  const range = request.method === "GET" ? request.headers.range : undefined;
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start > end) {
      await file.close();
      response.writeHead(416, {
        ...headers,
        "Content-Range": `bytes */${size}`,
        "Content-Length": 0,
      });
      response.end();
      return;
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  response.writeHead(range ? 206 : 200, { ...headers, "Content-Length": end - start + 1 });
  if (request.method === "HEAD" || size === 0) {
    await file.close();
    response.end();
    return;
  }
  const stream = file.createReadStream({ start, end });
  stream.on("error", (error) => response.destroy(error));
  response.once("close", () => stream.destroy());
  stream.pipe(response);
}
