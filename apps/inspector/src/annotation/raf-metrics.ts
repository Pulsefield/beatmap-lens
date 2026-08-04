export const rafMetricWindowSize = 120;
export const rafMetricReportIntervalMs = 250;

export class RafMetrics {
  readonly #intervals: number[] = [];

  #previousTimestamp: number | undefined;
  #lastReportTimestamp: number | undefined;

  get intervalCount(): number {
    return this.#intervals.length;
  }

  get p95Ms(): number {
    const sorted = [...this.#intervals].sort((left, right) => left - right);
    return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
  }

  recordFrame(timestamp: number): number | undefined {
    const previous = this.#previousTimestamp;
    this.#previousTimestamp = timestamp;

    if (previous === undefined) {
      this.#lastReportTimestamp = timestamp;
      return undefined;
    }

    this.#intervals.push(timestamp - previous);
    if (this.#intervals.length > rafMetricWindowSize) this.#intervals.shift();

    const lastReport = this.#lastReportTimestamp ?? timestamp;
    if (timestamp - lastReport < rafMetricReportIntervalMs) return undefined;

    this.#lastReportTimestamp = timestamp;
    return this.p95Ms;
  }

  reset(): void {
    this.#intervals.length = 0;
    this.#previousTimestamp = undefined;
    this.#lastReportTimestamp = undefined;
  }
}
