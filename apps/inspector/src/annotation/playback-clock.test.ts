import { describe, expect, it } from "vitest";
import {
  type PlaybackClockState,
  type PlaybackFrameScheduler,
  SyntheticPlaybackClock,
} from "./playback-clock";

describe("SyntheticPlaybackClock", () => {
  it.each([0.5, 0.75, 1, 1.25, 1.5])(
    "advances source time at %sx and retains exact selection boundaries",
    async (rate) => {
      const scheduler = new TestFrameScheduler();
      const clock = new SyntheticPlaybackClock(scheduler);
      clock.setPlaybackRate(rate);
      await clock.playSelection({ startMs: 1000, endMs: 3000 });
      scheduler.advance(400);
      expect(clock.currentTimeMs).toBe(1000 + 400 * rate);
      scheduler.advance(4000);
      expect(clock.currentTimeMs).toBe(3000);
      expect(clock.playing).toBe(false);
      await clock.loopSelection({ startMs: 1000, endMs: 2000 });
      scheduler.advance(2500);
      expect(clock.currentTimeMs).toBe(1000 + ((2500 * rate) % 1000));
    },
  );

  it("accounts for the old rate before changing rate between frames", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);
    clock.setPlaybackRate(0.5);
    await clock.play();
    scheduler.elapseWithoutFrame(200);
    clock.setPlaybackRate(1.5);
    expect(clock.currentTimeMs).toBe(100);
    scheduler.advance(200);
    expect(clock.currentTimeMs).toBe(400);
  });

  it("plays, pauses, and seeks on a deterministic frame scheduler", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);

    clock.seek(1_000);
    await clock.play();
    scheduler.advance(250);

    expect(clock.currentTimeMs).toBe(1_250);
    expect(clock.playing).toBe(true);

    clock.pause();
    scheduler.advance(500);

    expect(clock.currentTimeMs).toBe(1_250);
    expect(clock.playing).toBe(false);

    clock.seek(400);
    expect(clock.currentTimeMs).toBe(400);
  });

  it("stops exactly at the end of selection playback", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);

    await clock.playSelection({ startMs: 100, endMs: 250 });
    scheduler.advance(200);

    expect(clock.currentTimeMs).toBe(250);
    expect(clock.playing).toBe(false);
  });

  it("seeks to the selection start and keeps playing when looping", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    scheduler.advance(150);

    expect(clock.currentTimeMs).toBe(100);
    expect(clock.playing).toBe(true);

    scheduler.advance(40);
    expect(clock.currentTimeMs).toBe(140);
  });

  it("preserves overshoot across one or more loop boundaries", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    scheduler.advance(490);

    expect(clock.currentTimeMs).toBe(140);
    expect(clock.playing).toBe(true);
  });

  it("rebinds an active loop without exposing a paused state", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);
    await clock.loopSelection({ startMs: 100, endMs: 250 });
    const states: { readonly looping: boolean; readonly playing: boolean }[] = [];
    const unsubscribe = clock.subscribe((state) => states.push(state));
    states.length = 0;

    await clock.loopSelection({ startMs: 300, endMs: 450 });

    expect(clock.currentTimeMs).toBe(300);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => state.playing && state.looping)).toBe(true);
    unsubscribe();
  });

  it("seeks within an active loop without clearing transport state", async () => {
    const clock = new SyntheticPlaybackClock(new TestFrameScheduler());
    const states: PlaybackClockState[] = [];
    clock.subscribe((state) => states.push(state));
    await clock.loopSelection({ startMs: 100, endMs: 250 });

    clock.seek(200);

    expect(states.at(-1)).toMatchObject({ currentTimeMs: 200, looping: true, playing: true });
  });

  it("clears a paused loop so the next loop command starts immediately", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);
    let looping = false;
    clock.subscribe((state) => {
      looping = state.looping;
    });

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    clock.pause();

    expect(looping).toBe(false);
    await clock.loopSelection({ startMs: 300, endMs: 450 });
    expect(clock.currentTimeMs).toBe(300);
    expect(clock.playing).toBe(true);
  });

  it("applies selection boundaries before an explicit pause clears selection state", async () => {
    const scheduler = new TestFrameScheduler();
    const clock = new SyntheticPlaybackClock(scheduler);

    await clock.playSelection({ startMs: 100, endMs: 250 });
    scheduler.elapseWithoutFrame(200);
    clock.pause();
    expect(clock.currentTimeMs).toBe(250);

    await clock.loopSelection({ startMs: 100, endMs: 250 });
    scheduler.elapseWithoutFrame(490);
    clock.pause();
    expect(clock.currentTimeMs).toBe(140);
  });
});

class TestFrameScheduler implements PlaybackFrameScheduler {
  #timeMs = 0;
  #nextHandle = 1;
  #callbacks = new Map<number, (timeMs: number) => void>();

  now(): number {
    return this.#timeMs;
  }

  requestFrame(callback: (timeMs: number) => void): number {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.#callbacks.delete(handle);
  }

  advance(elapsedMs: number): void {
    this.#timeMs += elapsedMs;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback(this.#timeMs);
  }

  elapseWithoutFrame(elapsedMs: number): void {
    this.#timeMs += elapsedMs;
  }
}
