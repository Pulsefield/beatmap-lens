# Bounded animation rendering

- Status: Implemented
- Date: 2026-09-21

The package adds animated WebP and GIF export, prioritizing Node.js encoding while keeping
browser-usable frame generation. The user explicitly selected this runtime boundary.
The [package README](../../packages/beatmap-lens/README.md#animated-webp-and-gif-nodejs) owns
the public API and defaults.

## Progressive API

Following the progressive approach described in Anthony Fu's
[The Progressive Path](https://talks.antfu.me/2024/vue-amsterdam/1), the convenient operation is
a composition of the same public primitives available to advanced callers:

```text
renderAnimation(chart, options)                  beatmap-lens/node
  createRenderAnimation(chart, options)          beatmap-lens
  iterateAnimationFrames(animation)              beatmap-lens
    createAnimationScene(animation, timeMs)      beatmap-lens
  encodeAnimation(frames, options)               beatmap-lens/node
    serializeSvg(scene) -> Sharp -> WebP/GIF
```

An animation plan is plain inspectable data with resolved settings and a chart reference.
It does not allocate every frame or own a playback clock. A frame is an ordinary `RenderScene`
with sample timing, so callers can use the existing projection and SVG APIs, customize geometry,
or replace the encoder. The top-level options combine the concerns needed to export one image;
the lower APIs keep planning and encoding separate. There is no plugin registry or renderer class.

## Coordinates and timing

The required half-open range selects playback time. The frame viewport looks ahead from the
current source time rather than cropping chart data at the selected playback boundary. This
keeps approaching notes and active holds visible throughout the clip. Current time is anchored
to the beginning-of-time edge of the existing scene projection.

Viewport dimensions and theme metrics use logical pixels. `pixelRatio` changes only raster
resolution. `scrollSpeed` uses the existing osu!lazer landscape adapter; the mutually exclusive
`pixelsPerSecond` alternative exposes the actual projection scale and supports portrait scenes.
Timing/SV and rate mods are outside this constant-speed implementation.

Frame timestamps are calculated from the sample index; a final partial sample ends at the
requested boundary. Encoders use cumulative rounded boundaries to avoid frame-rate drift.
WebP uses 1ms units, GIF 10ms. Frames below practical minimum delays are coalesced, including a
short final remainder. Sharp/libvips was observed replacing WebP delays of 1ms and 10ms with
100ms, while preserving 11ms. The
[WebP specification](https://developers.google.com/speed/webp/docs/riff_container#animation)
also leaves very short delays dependent on the player. The encoder uses minimum delays of
11ms for WebP and 20ms for GIF. Result metadata reports actual encoded dimensions, frame count
and duration; stationary WebP output can be a still image with no stored timing.

Fixed viewports compute a time span from their height and pixel speed. Linear projection
validation therefore permits a few floating-point ULPs of endpoint arithmetic error instead of
requiring exact equality. This keeps frame dimensions stable without rounding source times or
changing existing static SVG output.

## Node boundary and resources

Sharp is a normal dependency for ready-to-use exports, isolated behind `beatmap-lens/node` so
core browser imports do not resolve native code. Its
[animation output](https://sharp.pixelplumbing.com/api-output/) supplies both encoders and
their format-specific controls. Frames are rasterized sequentially into compressed PNGs before
being joined. This avoids retaining a JavaScript RGBA filmstrip, but encoding is still in memory
and its resource use grows with duration and resolution. There is no filesystem or network I/O
for chart data and no external command-line encoder.

Native frame assembly is deliberately separate from core geometry. In particular, resizing a
joined SVG sequence in Sharp 0.35.4 did not preserve the requested per-frame height in a local
probe; rasterizing each scene at its target size before joining avoids that behavior.

Tests decode real WebP/GIF output, check dimensions, timing, loop metadata and pixels, and cover
composition, frame customization, fractional sampling, long-note clipping, direction and 4K–10K
geometry. Type contracts and runtime export checks preserve the entry-point boundaries.
