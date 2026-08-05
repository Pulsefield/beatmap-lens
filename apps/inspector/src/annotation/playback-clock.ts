export interface PlaybackSelection {
  readonly startMs: number;
  readonly endMs: number;
}

export interface PlaybackClockState {
  readonly currentTimeMs: number;
  readonly playing: boolean;
  readonly looping: boolean;
  readonly selection?: PlaybackSelection;
}

export type PlaybackClockListener = (state: PlaybackClockState) => void;

export interface PlaybackClock {
  readonly currentTimeMs: number;
  readonly playing: boolean;

  play(): Promise<void>;
  pause(): void;
  seek(timeMs: number): void;
  playSelection(selection: PlaybackSelection): Promise<void>;
  loopSelection(selection: PlaybackSelection): Promise<void>;
  subscribe(listener: PlaybackClockListener): () => void;
  dispose(): void;
}

export interface PlaybackFrameScheduler {
  now(): number;
  requestFrame(callback: (timeMs: number) => void): number;
  cancelFrame(handle: number): void;
}

export const animationFrameScheduler: PlaybackFrameScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

type SelectionPlayback = {
  readonly range: PlaybackSelection;
  readonly loop: boolean;
};

export class SyntheticPlaybackClock implements PlaybackClock {
  readonly #scheduler: PlaybackFrameScheduler;
  readonly #listeners = new Set<PlaybackClockListener>();

  #timeMs = 0;
  #playing = false;
  #lastFrameTimeMs = 0;
  #frameHandle: number | undefined;
  #selectionPlayback: SelectionPlayback | undefined;
  #disposed = false;

  constructor(scheduler: PlaybackFrameScheduler = animationFrameScheduler) {
    this.#scheduler = scheduler;
  }

  get currentTimeMs(): number {
    return this.#timeMs;
  }

  get playing(): boolean {
    return this.#playing;
  }

  play(): Promise<void> {
    this.#selectionPlayback = undefined;
    this.#start();
    return Promise.resolve();
  }

  pause(): void {
    if (!this.#playing) {
      this.#selectionPlayback = undefined;
      return;
    }

    this.#advance(this.#scheduler.now());
    this.#selectionPlayback = undefined;
    this.#stop();
    this.#emit();
  }

  seek(timeMs: number): void {
    this.#timeMs = Math.max(0, timeMs);
    this.#lastFrameTimeMs = this.#scheduler.now();
    this.#emit();
  }

  playSelection(selection: PlaybackSelection): Promise<void> {
    this.#selectionPlayback = { range: selection, loop: false };
    this.#timeMs = selection.startMs;
    this.#lastFrameTimeMs = this.#scheduler.now();
    this.#start();
    return Promise.resolve();
  }

  loopSelection(selection: PlaybackSelection): Promise<void> {
    this.#selectionPlayback = { range: selection, loop: true };
    this.#timeMs = selection.startMs;
    this.#lastFrameTimeMs = this.#scheduler.now();
    this.#start();
    return Promise.resolve();
  }

  subscribe(listener: PlaybackClockListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state());
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;
    this.#stop();
    this.#listeners.clear();
  }

  #start(): void {
    if (this.#disposed || this.#playing) {
      this.#emit();
      return;
    }

    this.#playing = true;
    this.#lastFrameTimeMs = this.#scheduler.now();
    this.#scheduleFrame();
    this.#emit();
  }

  #stop(): void {
    this.#playing = false;
    if (this.#frameHandle === undefined) return;

    this.#scheduler.cancelFrame(this.#frameHandle);
    this.#frameHandle = undefined;
  }

  #scheduleFrame(): void {
    if (!this.#playing || this.#frameHandle !== undefined) return;

    this.#frameHandle = this.#scheduler.requestFrame((timeMs) => {
      this.#frameHandle = undefined;
      if (!this.#playing) return;

      this.#advance(timeMs);
      this.#emit();
      this.#scheduleFrame();
    });
  }

  #advance(frameTimeMs: number): void {
    const elapsedMs = Math.max(0, frameTimeMs - this.#lastFrameTimeMs);
    this.#lastFrameTimeMs = frameTimeMs;
    this.#timeMs += elapsedMs;

    const playback = this.#selectionPlayback;
    if (!playback || this.#timeMs < playback.range.endMs) return;

    if (playback.loop) {
      const durationMs = playback.range.endMs - playback.range.startMs;
      this.#timeMs =
        playback.range.startMs + ((this.#timeMs - playback.range.startMs) % durationMs);
      return;
    }

    this.#timeMs = playback.range.endMs;
    this.#stop();
  }

  #state(): PlaybackClockState {
    const playback = this.#selectionPlayback;
    return {
      currentTimeMs: this.#timeMs,
      playing: this.#playing,
      looping: playback?.loop ?? false,
      ...(playback ? { selection: playback.range } : {}),
    };
  }

  #emit(): void {
    const state = this.#state();
    for (const listener of this.#listeners) listener(state);
  }
}
