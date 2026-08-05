import { describe, expect, it } from "vitest";
import { MediaPlaybackClock } from "./media-playback-clock";
import type { PlaybackClockState, PlaybackFrameScheduler } from "./playback-clock";

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

  it("maps chart time to media time with the configured offset", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler, undefined, 100);

    clock.seek(1_250);
    expect(media.currentTime).toBe(1.35);
    expect(clock.currentTimeMs).toBe(1_250);

    await clock.play();
    media.currentTime = 3.5;
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(3_400);
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

  it("keeps chart time moving before a negative offset reaches media time zero", async () => {
    const media = new FakeAudio({ durationMs: 1_000 });
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler, undefined, -100);

    clock.seek(0);
    await clock.play();

    expect(clock.playing).toBe(true);
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(true);
    expect(media.playCalls).toBe(0);

    scheduler.advance(50);
    expect(clock.currentTimeMs).toBe(50);
    expect(media.paused).toBe(true);

    scheduler.advance(60);
    await Promise.resolve();

    expect(clock.currentTimeMs).toBe(110);
    expect(media.currentTime).toBe(0.01);
    expect(media.paused).toBe(false);
    expect(media.playCalls).toBe(1);
  });

  it("keeps chart time moving after a positive offset passes media duration", async () => {
    const media = new FakeAudio({ durationMs: 1_000 });
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler, undefined, 100);

    clock.seek(950);
    await clock.play();

    expect(clock.playing).toBe(true);
    expect(media.currentTime).toBe(1);
    expect(media.paused).toBe(true);
    expect(media.playCalls).toBe(0);

    scheduler.advance(75);

    expect(clock.currentTimeMs).toBe(1_025);
    expect(media.currentTime).toBe(1);
    expect(clock.playing).toBe(true);
  });

  it("continues chart time from the exact media end boundary", async () => {
    const media = new FakeAudio({ durationMs: 1_000 });
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler, undefined, 100);

    clock.seek(800);
    await clock.play();
    media.currentTime = 1;
    media.paused = true;
    media.dispatchEvent(new Event("ended"));

    expect(clock.currentTimeMs).toBe(900);
    expect(media.currentTime).toBe(1);
    expect(clock.playing).toBe(true);

    scheduler.advance(50);

    expect(clock.currentTimeMs).toBe(950);
    expect(media.currentTime).toBe(1);
    expect(clock.playing).toBe(true);
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

  it("checks selection playback boundaries in chart time when offset is non-zero", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler, undefined, 100);

    await clock.playSelection({ startMs: 100, endMs: 250 });
    expect(media.currentTime).toBe(0.2);

    media.currentTime = 0.36;
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(250);
    expect(media.currentTime).toBe(0.35);
    expect(clock.playing).toBe(false);

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    media.currentTime = 0.35;
    scheduler.frame();

    expect(clock.currentTimeMs).toBe(100);
    expect(media.currentTime).toBe(0.2);
    expect(clock.playing).toBe(true);
  });

  it("rebinds an active loop without exposing a paused state", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);
    await clock.loopSelection({ startMs: 100, endMs: 250 });
    const states: { readonly looping: boolean; readonly playing: boolean }[] = [];
    const unsubscribe = clock.subscribe((state) => states.push(state));
    states.length = 0;

    await clock.loopSelection({ startMs: 300, endMs: 450 });

    expect(clock.currentTimeMs).toBe(300);
    expect(media.currentTime).toBe(0.3);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => state.playing && state.looping)).toBe(true);
    unsubscribe();
  });

  it("seeks within an active loop without clearing transport state", async () => {
    const media = new FakeAudio();
    const clock = new MediaPlaybackClock(asMedia(media), new TestFrameScheduler());
    const states: PlaybackClockState[] = [];
    clock.subscribe((state) => states.push(state));
    await clock.loopSelection({ startMs: 100, endMs: 250 });

    clock.seek(200);

    expect(media.currentTime).toBe(0.2);
    expect(states.at(-1)).toMatchObject({ currentTimeMs: 200, looping: true, playing: true });
  });

  it("retimes media without moving chart time when the offset changes during playback", async () => {
    const media = new FakeAudio();
    const scheduler = new TestFrameScheduler();
    const clock = new MediaPlaybackClock(asMedia(media), scheduler);

    await clock.play();
    media.currentTime = 1.25;
    scheduler.frame();

    clock.setAudioOffsetMs(100);

    expect(clock.audioOffsetMs).toBe(100);
    expect(clock.currentTimeMs).toBe(1_250);
    expect(media.currentTime).toBe(1.35);
    expect(clock.playing).toBe(true);
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
  duration = Number.NaN;
  error: MediaError | null = null;
  playbackRate = 1;
  paused = true;
  playCalls = 0;
  readonly #deferPlay: boolean;
  #pendingPlay: (() => void) | undefined;
  #nextPlayError: Error | undefined;

  constructor(options: { readonly deferPlay?: boolean; readonly durationMs?: number } = {}) {
    super();
    this.#deferPlay = options.deferPlay ?? false;
    if (options.durationMs !== undefined) this.duration = options.durationMs / 1_000;
  }

  play(): Promise<void> {
    this.playCalls++;
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
  #timeMs = 0;
  #callback: ((timeMs: number) => void) | undefined;

  now(): number {
    return this.#timeMs;
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
    callback?.(this.#timeMs);
  }

  advance(elapsedMs: number): void {
    this.#timeMs += elapsedMs;
    this.frame();
  }
}
