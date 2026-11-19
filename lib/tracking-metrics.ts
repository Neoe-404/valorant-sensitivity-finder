import { mean, median, percentile, standardDeviation } from "./statistics";
import type { TrackingSample } from "@/types";

export type TrackingScoringMethod = "time" | "frames";

interface TrackingMetrics {
  durationMs: number;
  avgError: number;
  medianError: number;
  p95Error: number;
  errorStd: number;
  coverage: number;
  velocityDiffRatio: number;
  jitter: number;
}

interface ErrorInterval {
  durationMs: number;
  low: number;
  high: number;
  jitter: number;
}

const MIN_TARGET_SPEED = 8;

// 在两次测量之间线性估计误差。没有观测到的区间不参与统计。
function timeWithinError(intervals: ErrorInterval[], threshold: number): number {
  let time = 0;
  for (const { durationMs, low, high } of intervals) {
    if (threshold >= high) time += durationMs;
    else if (threshold > low) time += durationMs * (threshold - low) / (high - low);
  }
  return time;
}

function errorPercentile(intervals: ErrorInterval[], maxError: number, timeThreshold: number): number {
  let low = 0;
  let high = maxError;
  for (let i = 0; i < 32 && low < high; i++) {
    const middle = (low + high) / 2;
    if (timeWithinError(intervals, middle) >= timeThreshold) high = middle;
    else low = middle;
  }
  return high;
}

function jitterPercentile(intervals: ErrorInterval[], timeThreshold: number): number {
  const sorted = [...intervals].sort((a, b) => a.jitter - b.jitter);
  let time = 0;
  for (const interval of sorted) {
    time += interval.durationMs;
    if (time >= timeThreshold) return interval.jitter;
  }
  return 0;
}

function summarizeByTime(samples: TrackingSample[], errors: number[], radius: number): TrackingMetrics | null {
  const intervals: ErrorInterval[] = [];
  let durationMs = 0;
  let errorSum = 0;
  let errorSquareSum = 0;
  let velocitySum = 0;
  let maxError = 0;
  let previousIndex = 0;

  for (let i = 1; i < samples.length; i++) {
    const previous = samples[previousIndex];
    const current = samples[i];
    const dt = current.t - previous.t;
    if (!Number.isFinite(dt) || dt < 0) continue;
    const startError = errors[previousIndex];
    previousIndex = i;
    if (dt === 0) continue;

    const endError = errors[i];
    const dtSec = dt / 1000;
    const targetDx = current.targetX - previous.targetX;
    const targetDy = current.targetY - previous.targetY;
    const relativeDx = current.cursorX - previous.cursorX - targetDx;
    const relativeDy = current.cursorY - previous.cursorY - targetDy;
    // 速度差按向量比较，反向移动不能因为速度大小相同而拿到满分。
    const velocityError = Math.hypot(relativeDx, relativeDy) /
      Math.max(Math.hypot(targetDx, targetDy), MIN_TARGET_SPEED * dtSec);

    durationMs += dt;
    errorSum += dt * (startError + endError) / 2;
    errorSquareSum += dt * (startError ** 2 + startError * endError + endError ** 2) / 3;
    velocitySum += dt * velocityError;
    const high = Math.max(startError, endError);
    maxError = Math.max(maxError, high);
    intervals.push({ durationMs: dt, low: Math.min(startError, endError), high, jitter: Math.abs(endError - startError) / dtSec });
  }

  if (durationMs === 0) return null;
  const avgError = errorSum / durationMs;
  return {
    durationMs,
    avgError,
    medianError: errorPercentile(intervals, maxError, durationMs * 0.5),
    p95Error: errorPercentile(intervals, maxError, durationMs * 0.95),
    errorStd: Math.sqrt(Math.max(0, errorSquareSum / durationMs - avgError ** 2)),
    coverage: timeWithinError(intervals, radius) / durationMs,
    velocityDiffRatio: velocitySum / durationMs,
    jitter: jitterPercentile(intervals, durationMs * 0.75),
  };
}

/** 旧进度已保存部分旧分数，续测时沿用当时的逐帧规则。 */
function summarizeByFrames(samples: TrackingSample[], errors: number[], radius: number): TrackingMetrics {
  let velocitySum = 0;
  const jitter: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    const dtSec = (current.t - previous.t) / 1000;
    if (dtSec <= 0) continue;
    const cursorSpeed = Math.hypot(current.cursorX - previous.cursorX, current.cursorY - previous.cursorY) / dtSec;
    const targetSpeed = Math.hypot(current.targetX - previous.targetX, current.targetY - previous.targetY) / dtSec;
    velocitySum += Math.abs(cursorSpeed - targetSpeed) / Math.max(targetSpeed, MIN_TARGET_SPEED);
    jitter.push(Math.abs(errors[i] - errors[i - 1]) / dtSec);
  }
  return {
    durationMs: samples[samples.length - 1].t - samples[0].t,
    avgError: mean(errors),
    medianError: median(errors),
    p95Error: percentile(errors, 95),
    errorStd: standardDeviation(errors),
    coverage: errors.filter((error) => error <= radius).length / samples.length,
    velocityDiffRatio: velocitySum / samples.length,
    jitter: percentile(jitter, 75),
  };
}

export function trackingMetrics(
  samples: TrackingSample[],
  radius: number,
  method: TrackingScoringMethod,
): TrackingMetrics | null {
  if (!samples.length || !Number.isFinite(radius) || radius <= 0) return null;
  const errors = samples.map((sample) => Math.hypot(sample.cursorX - sample.targetX, sample.cursorY - sample.targetY));
  if (errors.some((error) => !Number.isFinite(error))) return null;
  return method === "frames" ? summarizeByFrames(samples, errors, radius) : summarizeByTime(samples, errors, radius);
}
