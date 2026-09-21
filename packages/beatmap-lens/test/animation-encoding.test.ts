import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createRenderAnimation, iterateAnimationFrames, parseBeatmap } from "../src/index.js";
import { encodeAnimation, renderAnimation } from "../src/node.js";

const chart = parseBeatmap(`osu file format v14
[General]
Mode:3
[Difficulty]
CircleSize:4
[HitObjects]
64,192,200,1,0,0:0:0:0:
192,192,100,128,0,1200:0:0:0:0:
320,192,700,1,0,0:0:0:0:
448,192,1000,1,0,0:0:0:0:
`).chart;

const sceneOptions = {
  range: { startMs: 0, endMs: 255 },
  viewport: { widthPx: 160, heightPx: 120 },
  pixelsPerSecond: 80,
  fps: 10,
};

describe("Node animation encoding", () => {
  it.each(["webp", "gif"] as const)(
    "exports decodable %s frames with dimensions, loop and timing",
    async (format) => {
      const output = await renderAnimation(chart, {
        ...sceneOptions,
        format,
        loop: 2,
        pixelRatio: 2,
      });
      expect(output.data).toBeInstanceOf(Uint8Array);
      expect(output).toMatchObject({
        format,
        mimeType: `image/${format}`,
        size: { widthPx: 320, heightPx: 240 },
        frameCount: 3,
        durationMs: format === "gif" ? 260 : 255,
      });
      const metadata = await sharp(output.data, { animated: true }).metadata();
      expect(metadata).toMatchObject({
        format,
        width: 320,
        pageHeight: 240,
        height: 720,
        pages: 3,
        loop: 2,
        delay: [100, 100, format === "gif" ? 60 : 55],
      });
      const first = await sharp(output.data, { page: 0 }).raw().toBuffer();
      const last = await sharp(output.data, { page: 2 }).raw().toBuffer();
      expect(first.equals(last)).toBe(false);
      // The original background and note colours survive the default lossless/palette path.
      expect([...first.subarray(0, 3)]).toEqual([16, 24, 32]);
    },
  );

  it.each(["webp", "gif"] as const)(
    "rounds %s timestamps cumulatively at 30fps",
    async (format) => {
      const output = await renderAnimation(chart, {
        ...sceneOptions,
        range: { startMs: 0, endMs: 1001 },
        fps: 30,
        format,
      });
      const metadata = await sharp(output.data, { animated: true }).metadata();
      expect(output.durationMs).toBe(format === "gif" ? 1000 : 1001);
      expect(metadata.delay?.slice(0, 3)).toEqual(format === "gif" ? [30, 40, 30] : [33, 34, 33]);
      expect(metadata.delay?.every((delay) => delay > 0)).toBe(true);
    },
  );

  it("keeps the shortcut identical to explicit planning and encoding", async () => {
    const animation = createRenderAnimation(chart, sceneOptions);
    const direct = await renderAnimation(chart, sceneOptions);
    const composed = await encodeAnimation(iterateAnimationFrames(animation));
    expect(direct).toEqual(composed);
  });

  it.each(["webp", "gif"] as const)(
    "preserves playback speed for 60fps %s input",
    async (format) => {
      const output = await renderAnimation(chart, {
        ...sceneOptions,
        range: { startMs: 0, endMs: 1000 },
        fps: 60,
        format,
      });
      const metadata = await sharp(output.data, { animated: true }).metadata();
      expect(output.durationMs).toBe(1000);
      expect(metadata.delay?.every((delay) => delay >= (format === "gif" ? 20 : 11))).toBe(true);
      if (format === "webp") expect(output.frameCount).toBe(60);
    },
  );

  it("propagates a caller's async frame failure without returning a partial image", async () => {
    const animation = createRenderAnimation(chart, sceneOptions);
    const failure = new Error("Frame pipeline stopped");
    async function* interruptedFrames() {
      yield* iterateAnimationFrames(animation);
      throw failure;
    }
    await expect(encodeAnimation(interruptedFrames())).rejects.toBe(failure);
  });

  it("encodes transformed scenes from an async frame pipeline", async () => {
    const animation = createRenderAnimation(chart, sceneOptions);
    async function* customizedFrames() {
      for (const frame of iterateAnimationFrames(animation)) {
        yield {
          ...frame,
          scene: {
            ...frame.scene,
            lanes: frame.scene.lanes.map((lane) => ({ ...lane, fill: "#ff0000" })),
          },
        };
      }
    }
    const output = await encodeAnimation(customizedFrames(), {
      format: "gif",
      gif: { colours: 32 },
      loop: 1,
    });
    const metadata = await sharp(output.data, { animated: true }).metadata();
    expect(metadata.loop).toBe(1);
    const { data, info } = await sharp(output.data).raw().toBuffer({ resolveWithObject: true });
    const offset = (30 * info.width + 18) * info.channels;
    expect([...data.subarray(offset, offset + 3)]).toEqual([255, 0, 0]);
  });

  it.each(["webp", "gif"] as const)("handles a single sub-frame %s clip", async (format) => {
    const output = await renderAnimation(chart, {
      ...sceneOptions,
      range: { startMs: 0, endMs: 1 },
      format,
    });
    const metadata = await sharp(output.data).metadata();
    expect(metadata).toMatchObject({ format, width: 160, height: 120 });
    expect(output.frameCount).toBe(1);
    expect(output.durationMs).toBe(format === "gif" ? 20 : 0);
  });

  it.each(["webp", "gif"] as const)("handles a stationary %s clip", async (format) => {
    const output = await renderAnimation({ ...chart, notes: [] }, { ...sceneOptions, format });
    const metadata = await sharp(output.data, { animated: true }).metadata();
    expect(output.frameCount).toBe(format === "gif" ? 3 : 1);
    expect(output.durationMs).toBe(format === "gif" ? 260 : 0);
    expect(metadata.width).toBe(160);
    expect(metadata.pageHeight ?? metadata.height).toBe(120);
  });
});
