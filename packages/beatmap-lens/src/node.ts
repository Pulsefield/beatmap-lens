import { Buffer } from "node:buffer";
import sharp, { type GifOptions, type WebpOptions } from "sharp";
import { createRenderAnimation, iterateAnimationFrames } from "./render-animation.js";
import { serializeSvg } from "./svg.js";
import type {
  ManiaChart,
  RenderAnimationFrame,
  RenderAnimationOptions,
  RenderScene,
  SizePx,
} from "./types.js";

export type EncodeAnimationOptions = {
  /** Output pixels per logical scene pixel. Defaults to 1. */
  readonly pixelRatio?: number;
  /** Total plays; 0 repeats forever, 1 plays once. Defaults to 0. */
  readonly loop?: number;
} & (
  | {
      readonly format?: "webp";
      /** Sharp's WebP controls. Defaults to lossless encoding. */
      readonly webp?: Omit<WebpOptions, "loop" | "delay" | "force">;
      readonly gif?: never;
    }
  | {
      readonly format: "gif";
      /** Sharp's GIF controls. Defaults to no dithering and keeps duplicate frames. */
      readonly gif?: Omit<GifOptions, "loop" | "delay" | "force">;
      readonly webp?: never;
    }
);

export type RenderAnimationExportOptions = RenderAnimationOptions & EncodeAnimationOptions;

export interface EncodedAnimation {
  readonly data: Uint8Array;
  readonly format: "webp" | "gif";
  readonly mimeType: "image/webp" | "image/gif";
  /** Actual raster dimensions, including pixelRatio. */
  readonly size: SizePx;
  /** Frame count after encoder coalescing. */
  readonly frameCount: number;
  /** Duration after rounding to the format's time unit. A still WebP has no stored duration. */
  readonly durationMs: number;
}

/** Render a bounded chart animation to an in-memory WebP (default) or GIF. Node.js only. */
export async function renderAnimation(
  chart: ManiaChart,
  options: RenderAnimationExportOptions,
): Promise<EncodedAnimation> {
  return encodeAnimation(iterateAnimationFrames(createRenderAnimation(chart, options)), options);
}

/** Encode caller-controlled scenes and durations; accepts sync and async frame pipelines. */
export async function encodeAnimation(
  frames:
    | Iterable<Pick<RenderAnimationFrame, "scene" | "durationMs">>
    | AsyncIterable<Pick<RenderAnimationFrame, "scene" | "durationMs">>,
  options: EncodeAnimationOptions = {},
): Promise<EncodedAnimation> {
  const format = options.format ?? "webp";
  const pixelRatio = options.pixelRatio ?? 1;
  const loop = options.loop ?? 0;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new RangeError("pixelRatio must be finite and positive.");
  }
  // Rounding cumulative boundaries, rather than individual delays, preserves clip duration at 30/60fps.
  const quantumMs = format === "gif" ? 10 : 1;
  // libvips replaces WebP delays <= 10ms with 100ms; common GIF players do the same.
  const minimumDelayMs = format === "gif" ? 20 : 11;
  const images: Buffer[] = [];
  const delay: number[] = [];
  let elapsedMs = 0;
  let elapsedTicks = 0;
  let viewport: SizePx | undefined;
  let size: SizePx | undefined;
  let pendingScene: RenderScene | undefined;

  for await (const frame of frames) {
    if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
      throw new RangeError("Frame durationMs must be finite and positive.");
    }
    viewport ??= frame.scene.size;
    if (
      frame.scene.size.widthPx !== viewport.widthPx ||
      frame.scene.size.heightPx !== viewport.heightPx
    ) {
      throw new RangeError("All animation frames must have the same scene size.");
    }
    size ??= {
      widthPx: Math.max(1, Math.round(viewport.widthPx * pixelRatio)),
      heightPx: Math.max(1, Math.round(viewport.heightPx * pixelRatio)),
    };
    pendingScene ??= frame.scene;
    elapsedMs += frame.durationMs;
    const endTicks = Math.max(1, Math.round(elapsedMs / quantumMs));
    const frameDelayMs = (endTicks - elapsedTicks) * quantumMs;
    // Coalesce short samples so the encoded file plays at the requested overall speed.
    if (frameDelayMs < minimumDelayMs) continue;
    elapsedTicks = endTicks;
    delay.push(frameDelayMs);
    images.push(await rasterizeScene(pendingScene, size, pixelRatio));
    pendingScene = undefined;
  }
  if (!size) {
    throw new RangeError("At least one animation frame is required.");
  }
  const remainingMs = (Math.max(1, Math.round(elapsedMs / quantumMs)) - elapsedTicks) * quantumMs;
  if (images.length === 0 && pendingScene) {
    images.push(await rasterizeScene(pendingScene, size, pixelRatio));
    delay.push(Math.max(minimumDelayMs, remainingMs));
  } else if (remainingMs > 0) {
    delay[delay.length - 1] = (delay.at(-1) as number) + remainingMs;
  }
  const image =
    images.length === 1 ? sharp(images[0]) : sharp(images, { join: { animated: true } });
  if (options.format === "gif") {
    image.gif({ dither: 0, keepDuplicateFrames: true, ...options.gif, loop, delay, force: true });
  } else {
    image.webp({ lossless: true, ...options.webp, loop, delay, force: true });
  }
  const { data } = await image.toUint8Array();
  const metadata = await sharp(data, { animated: true }).metadata();
  return {
    data,
    format,
    mimeType: format === "gif" ? "image/gif" : "image/webp",
    size,
    frameCount: metadata.pages ?? 1,
    durationMs: metadata.delay?.reduce((sum, value) => sum + value, 0) ?? 0,
  };
}

function rasterizeScene(scene: RenderScene, size: SizePx, pixelRatio: number): Promise<Buffer> {
  // Retain compressed frames rather than a full RGBA filmstrip.
  return sharp(Buffer.from(serializeSvg(scene)), {
    density: Math.max(1, Math.round(72 * pixelRatio)),
  })
    .resize(size.widthPx, size.heightPx, { fit: "fill" })
    .png({ compressionLevel: 1 })
    .toBuffer();
}
