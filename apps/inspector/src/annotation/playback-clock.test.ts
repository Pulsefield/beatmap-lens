import { describe, expect, it } from "vitest";
import { type PlaybackFrameScheduler, SyntheticPlaybackClock } from "./playback-clock";

describe("SyntheticPlaybackClock", () => {
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
