import { describe, expect, it } from "vitest";
import { MediaPlaybackClock } from "./media-playback-clock";
import type { PlaybackFrameScheduler } from "./playback-clock";

describe("MediaPlaybackClock", () => {
  it("uses media currentTime as the authoritative clock", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);

    clock.seek(1_250);
    expect(media.currentTime).toBe(1.25);

    await clock.play();
    media.currentTime = 3.5;
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(3_500);
    expect(clock.playing).toBe(true);
  });

  it("does not couple playback to visual speed or media playbackRate", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);

    media.playbackRate = 1.25;
    await clock.play();
    clock.seek(2_000);
    scheduler.frame();
    clock.pause();

    expect(media.playbackRate).toBe(1.25);
  });

  it("clamps selection playback and loops from the exact boundary", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);

    await clock.playSelection({ startMs: 100, endMs: 250 });
    media.currentTime = 0.3;
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(250);
    expect(clock.playing).toBe(false);

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    media.currentTime = 0.25;
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(100);
    expect(clock.playing).toBe(true);

    media.currentTime = 0.25;
    scheduler.frame();
    expect(clock.currentTimeMs).toBe(100);
  });

  it("does not restart a loop after an explicit pause at the boundary", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    media.currentTime = 0.25;
    clock.pause();
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(250);
    expect(clock.playing).toBe(false);
    expect(media.paused).toBe(true);
  });

  it("ignores a stale play resolution after pause", async () => {
    const media = new FakeAudio({ deferPlay: true });
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);

    const started = clock.play();
    clock.pause();
    media.resolvePlay();
    await started;
    scheduler.frame();

    expect(clock.playing).toBe(false);
    expect(media.paused).toBe(true);
  });

  it("reports a rejected automatic loop restart", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const errors: unknown[] = [];
    const clock = new MediaPlaybackClock(asMedia(media), scheduler, (error) => {
      errors.push(error);
    });
    await clock.loopSelection({ startMs: 100, endMs: 250 });
    media.currentTime = 0.25;
    media.paused = true;
    media.rejectNextPlay(new Error("Loop restart rejected"));

    scheduler.frame();
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(new Error("Loop restart rejected"));
  });
});

class FakeAudio extends EventTarget {
  currentTime = 0;
  error: MediaError | null = null;
  playbackRate = 1;
  paused = true;
  readonly #deferPlay: boolean;
  #pendingPlay: (() => void) | undefined;
  #nextPlayError: Error | undefined;

  constructor(options: { readonly deferPlay?: boolean } = {}) {
    super();
    this.#deferPlay = options.deferPlay ?? false;
  }

  play(): Promise<void> {
    if (this.#nextPlayError) {
      const error = this.#nextPlayError;
      this.#nextPlayError = undefined;
      return Promise.reject(error);
    }
    if (!this.#deferPlay) {
      this.#startPlayback();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.#pendingPlay = () => {
        this.#startPlayback();
        resolve();
      };
    });
  }

  pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  resolvePlay(): void {
    const pending = this.#pendingPlay;
    this.#pendingPlay = undefined;
    pending?.();
  }

  rejectNextPlay(error: Error): void {
    this.#nextPlayError = error;
  }

  #startPlayback(): void {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
}

function asMedia(media: FakeAudio): HTMLAudioElement {
  return media as unknown as HTMLAudioElement;
}

class TestFrameScheduler implements PlaybackFrameScheduler {
  #callback: ((timeMs: number) => void) | undefined;

  now(): number {
    return 0;
  }

  requestFrame(callback: (timeMs: number) => void): number {
    this.#callback = callback;
    return 1;
  }

  cancelFrame(): void {
    this.#callback = undefined;
  }

  frame(): void {
    const callback = this.#callback;
    this.#callback = undefined;
    callback?.(0);
  }
}
