import { describe, expect, it } from "vitest";
import { RafMetrics, rafMetricReportIntervalMs, rafMetricWindowSize } from "./raf-metrics";

describe("RafMetrics", () => {
  it("samples intervals between adjacent animation frame callbacks", () => {
    const metrics = new RafMetrics();

    metrics.recordFrame(0);
    metrics.recordFrame(16.7);
    metrics.recordFrame(33.4);

    expect(metrics.intervalCount).toBe(2);
    expect(metrics.p95Ms).toBeCloseTo(16.7);
  });

  it("does not bridge timestamps across a reset", () => {
    const metrics = new RafMetrics();

    metrics.recordFrame(0);
    metrics.recordFrame(16);
    metrics.reset();
    metrics.recordFrame(5_016);
    metrics.recordFrame(5_032);

    expect(metrics.intervalCount).toBe(1);
    expect(metrics.p95Ms).toBe(16);
  });

  it("keeps the latest 120 intervals for rolling P95", () => {
    const metrics = new RafMetrics();
    let timestamp = 0;
    metrics.recordFrame(timestamp);

    timestamp += 1_000;
    metrics.recordFrame(timestamp);
    for (let index = 0; index < rafMetricWindowSize; index++) {
      timestamp += 10;
      metrics.recordFrame(timestamp);
    }

    expect(metrics.intervalCount).toBe(rafMetricWindowSize);
    expect(metrics.p95Ms).toBe(10);
  });

  it("uses nearest-rank P95 over the rolling interval window", () => {
    const metrics = new RafMetrics();
    let timestamp = 0;
    metrics.recordFrame(timestamp);

    for (let interval = 1; interval <= 100; interval++) {
      timestamp += interval;
      metrics.recordFrame(timestamp);
    }

    expect(metrics.p95Ms).toBe(95);
  });

  it("throttles reports without dropping frame samples", () => {
    const metrics = new RafMetrics();

    expect(metrics.recordFrame(0)).toBeUndefined();
    expect(metrics.recordFrame(100)).toBeUndefined();
    expect(metrics.recordFrame(249)).toBeUndefined();
    expect(metrics.recordFrame(rafMetricReportIntervalMs)).toBe(149);
    expect(metrics.intervalCount).toBe(3);

    expect(metrics.recordFrame(400)).toBeUndefined();
    expect(metrics.recordFrame(500)).toBe(150);
    expect(metrics.intervalCount).toBe(5);
  });

  it("clears the baseline, rolling window, and report throttle together", () => {
    const metrics = new RafMetrics();

    metrics.recordFrame(0);
    metrics.recordFrame(rafMetricReportIntervalMs);
    metrics.reset();

    expect(metrics.intervalCount).toBe(0);
    expect(metrics.p95Ms).toBe(0);
    expect(metrics.recordFrame(10_000)).toBeUndefined();
    expect(metrics.recordFrame(10_016)).toBeUndefined();
    expect(metrics.intervalCount).toBe(1);
  });
});
