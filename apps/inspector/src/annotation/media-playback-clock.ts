import {
  animationFrameScheduler,
  type PlaybackClock,
  type PlaybackClockListener,
  type PlaybackClockState,
  type PlaybackFrameScheduler,
  type PlaybackSelection,
} from "./playback-clock";

type SelectionPlayback = {
  readonly range: PlaybackSelection;
  readonly loop: boolean;
};

export type MediaPlaybackErrorListener = (error: unknown) => void;

export class MediaPlaybackClock implements PlaybackClock {
  readonly #media: HTMLAudioElement;
  readonly #scheduler: PlaybackFrameScheduler;
  readonly #listeners = new Set<PlaybackClockListener>();
  readonly #onMediaProgress = () => this.#handleProgress();
  readonly #onPlaybackError: MediaPlaybackErrorListener;
  readonly #onMediaError = () => this.#handleMediaError();

  #frameHandle: number | undefined;
  #selectionPlayback: SelectionPlayback | undefined;
  #commandId = 0;
  #pauseRequested = false;
  #disposed = false;

  constructor(
    media: HTMLAudioElement,
    scheduler: PlaybackFrameScheduler = animationFrameScheduler,
    onPlaybackError: MediaPlaybackErrorListener = () => {},
  ) {
    this.#media = media;
    this.#scheduler = scheduler;
    this.#onPlaybackError = onPlaybackError;
    this.#media.addEventListener("play", this.#onMediaProgress);
    this.#media.addEventListener("pause", this.#onMediaProgress);
    this.#media.addEventListener("timeupdate", this.#onMediaProgress);
    this.#media.addEventListener("seeking", this.#onMediaProgress);
    this.#media.addEventListener("ended", this.#onMediaProgress);
    this.#media.addEventListener("error", this.#onMediaError);
  }

  get currentTimeMs(): number {
    return this.#media.currentTime * 1_000;
  }

  get playing(): boolean {
    return !this.#media.paused;
  }

  play(): Promise<void> {
    this.#selectionPlayback = undefined;
    return this.#startPlayback();
  }

  pause(): void {
    this.#commandId++;
    this.#pauseRequested = true;
    this.#selectionPlayback = undefined;
    this.#media.pause();
    this.#cancelFrame();
    this.#emit();
  }

  seek(timeMs: number): void {
    this.#media.currentTime = Math.max(0, timeMs) / 1_000;
    this.#emit();
  }

  playSelection(selection: PlaybackSelection): Promise<void> {
    this.#selectionPlayback = { range: selection, loop: false };
    this.seek(selection.startMs);
    return this.#startPlayback();
  }

  loopSelection(selection: PlaybackSelection): Promise<void> {
    this.#selectionPlayback = { range: selection, loop: true };
    this.seek(selection.startMs);
    return this.#startPlayback();
  }

  subscribe(listener: PlaybackClockListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state());
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;
    this.pause();
    this.#media.removeEventListener("play", this.#onMediaProgress);
    this.#media.removeEventListener("pause", this.#onMediaProgress);
    this.#media.removeEventListener("timeupdate", this.#onMediaProgress);
    this.#media.removeEventListener("seeking", this.#onMediaProgress);
    this.#media.removeEventListener("ended", this.#onMediaProgress);
    this.#media.removeEventListener("error", this.#onMediaError);
    this.#listeners.clear();
  }

  async #startPlayback(): Promise<void> {
    const commandId = ++this.#commandId;
    this.#pauseRequested = false;
    if (this.#disposed) return;

    try {
      await this.#media.play();
    } catch (error) {
      if (this.#disposed || commandId !== this.#commandId) return;

      this.#cancelFrame();
      this.#emit();
      throw error;
    }

    if (this.#disposed || commandId !== this.#commandId) {
      if (this.#disposed || this.#pauseRequested) this.#media.pause();
      this.#cancelFrame();
      return;
    }

    this.#scheduleFrame();
    this.#emit();
  }

  #handleProgress(): void {
    if (this.#disposed) return;

    const playback = this.#selectionPlayback;
    if (!playback || this.currentTimeMs < playback.range.endMs) {
      if (this.playing) this.#scheduleFrame();
      else this.#cancelFrame();
      this.#emit();
      return;
    }

    if (playback.loop) {
      if (this.#media.paused && this.#pauseRequested) {
        this.#cancelFrame();
        this.#emit();
        return;
      }

      this.#media.currentTime = playback.range.startMs / 1_000;
      if (this.#media.paused) void this.#resumeLoop(this.#commandId);
      else this.#scheduleFrame();
      this.#emit();
      return;
    }

    this.#media.currentTime = playback.range.endMs / 1_000;
    if (!this.#media.paused) this.#media.pause();
    this.#cancelFrame();
    this.#emit();
  }

  async #resumeLoop(commandId: number): Promise<void> {
    try {
      await this.#media.play();
    } catch (error) {
      if (this.#disposed || commandId !== this.#commandId) return;

      this.#cancelFrame();
      this.#onPlaybackError(error);
      this.#emit();
      return;
    }

    if (this.#disposed || commandId !== this.#commandId || this.#pauseRequested) {
      if (this.#disposed || this.#pauseRequested) this.#media.pause();
      this.#cancelFrame();
      return;
    }

    this.#scheduleFrame();
    this.#emit();
  }

  #handleMediaError(): void {
    if (this.#disposed) return;

    this.#cancelFrame();
    const message = this.#media.error?.message;
    this.#onPlaybackError(new Error(message || "Audio playback failed."));
    this.#emit();
  }

  #scheduleFrame(): void {
    if (this.#disposed || !this.playing || this.#frameHandle !== undefined) return;

    this.#frameHandle = this.#scheduler.requestFrame(() => {
      this.#frameHandle = undefined;
      this.#handleProgress();
    });
  }

  #cancelFrame(): void {
    if (this.#frameHandle === undefined) return;

    this.#scheduler.cancelFrame(this.#frameHandle);
    this.#frameHandle = undefined;
  }

  #state(): PlaybackClockState {
    const playback = this.#selectionPlayback;
    return {
      currentTimeMs: this.currentTimeMs,
      playing: this.playing,
      looping: playback?.loop ?? false,
      ...(playback ? { selection: playback.range } : {}),
    };
  }

  #emit(): void {
    const state = this.#state();
    for (const listener of this.#listeners) listener(state);
  }
}
