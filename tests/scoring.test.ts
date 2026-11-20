import { describe, it, expect } from "vitest";
import { mean, median, standardDeviation, clamp, percentile, cv, roundTo, consistencyAcross } from "../lib/statistics";
import { eDpi, sensitivityMultiplier, pathLength, dist2d } from "../lib/mouse-math";
import {
  computeFlickScore,
  computeTrackingScore,
  computeMicroScore,
  computeOverallScore,
  computePenalties,
} from "../lib/scoring";
import type {
  FlickTargetRecord,
  TrackingSample,
  MicroTargetRecord,
} from "../types";

describe("statistics", () => {
  it("mean / median / std", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([2, 4])).toBe(3);
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 2);
  });

  it("clamp / percentile / cv", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    expect(cv([10, 10, 10])).toBe(0);
  });

  it("roundTo / consistencyAcross / empty-input guards", () => {
    expect(roundTo(0.333333)).toBeCloseTo(0.333, 6);
    expect(roundTo(1.23456, 2)).toBeCloseTo(1.23, 6);
    expect(standardDeviation([])).toBe(0);
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(consistencyAcross(90, 90, 90)).toBe(100);
    expect(consistencyAcross(100, 50, 0)).toBeLessThan(30);
  });
});

describe("eDPI & multiplier", () => {
  it("edpi = dpi * sensitivity", () => {
    expect(eDpi(800, 0.35)).toBeCloseTo(280, 6);
    expect(eDpi(1600, 0.14)).toBeCloseTo(224, 6);
  });

  it("sensitivityMultiplier", () => {
    expect(sensitivityMultiplier(0.28, 0.35)).toBeCloseTo(0.8, 3);
    expect(sensitivityMultiplier(0.42, 0.35)).toBeCloseTo(1.2, 3);
    expect(sensitivityMultiplier(0.35, 0.35)).toBe(1);
    expect(sensitivityMultiplier(0.7, 0)).toBe(1); // 除零保护
  });

  it("pathLength & dist2d", () => {
    expect(dist2d(0, 0, 3, 4)).toBe(5);
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 8 }])).toBeCloseTo(9, 6);
  });
});

function makeFlick(
  targetRadius: number,
  count: number,
  overrides: Partial<FlickTargetRecord>[] = []
): FlickTargetRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const o = overrides[i] ?? {};
    return {
      targetId: i,
      targetX: 500,
      targetY: 300,
      targetRadius,
      startX: 200,
      startY: 200,
      spawnTime: i * 1000,
      firstMoveTime: i * 1000 + 150,
      hitTime: i * 1000 + 500,
      hitX: 480,
      hitY: 295,
      hit: true,
      pathSampleCount: 10,
      totalMouseDistance: 400,
      idealDistance: 316,
      correctionCount: 0,
      overshoot: false,
      overshootDistance: 0,
      undershoot: false,
      reactionTime: 150,
      timeToTarget: 500,
      ...o,
    };
  });
}

describe("scoring: flick", () => {
  it("does not let one quick hit offset nineteen misses", () => {
    const records = makeFlick(36, 20, [
      { timeToTarget: 300, reactionTime: 120, totalMouseDistance: 316 },
      ...Array.from({ length: 19 }, () => ({ hit: false })),
    ]);
    const result = computeFlickScore({ records, targetRadius: 36, durationMs: 10000 });
    expect(result.accuracy).toBe(0.05);
    expect(result.avgTimeToTarget).toBe(300);
    expect(result.breakdown.speed).toBe(5);
    expect(result.consistency).toBe(0);
    expect(result.score).toBeCloseTo(4);
    const legacy = computeFlickScore({ records, targetRadius: 36, durationMs: 10000, method: "hits-only" });
    expect(legacy.score).toBeCloseTo(73.4);
  });

  it("no hits never earn speed, reaction or consistency points", () => {
    const records = makeFlick(36, 20, Array.from({ length: 20 }, () => ({ hit: false })));
    const noHits = computeFlickScore({ records, targetRadius: 36, durationMs: 10000 });
    expect(noHits.score).toBe(0);
    expect(Object.values(noHits.breakdown)).toEqual([0, 0, 0, 0, 0]);
    records[0] = { ...records[0], hit: true, timeToTarget: 2000, reactionTime: 1000 };
    expect(computeFlickScore({ records, targetRadius: 36, durationMs: 10000 }).score).toBeGreaterThan(noHits.score);
    expect(computeFlickScore({ records: [], targetRadius: 36, durationMs: 0 }).score).toBe(0);
  });
  it("perfect-ish flick gets a strong score and drops with overshoot", () => {
    const good = makeFlick(40, 20); // 全部命中
    const goodResult = computeFlickScore({ records: good, targetRadius: 40, durationMs: 20000 });
    expect(goodResult.score).toBeGreaterThan(80);
    expect(goodResult.accuracy).toBe(1);
    expect(goodResult.avgEfficiency).toBeGreaterThan(0.7);

    // 全部过冲 + 大量修正 + 慢
    const bad = makeFlick(40, 20, [
      { overshoot: true, overshootDistance: 60, correctionCount: 4, timeToTarget: 1200, reactionTime: 350 },
      { overshoot: true, overshootDistance: 55, correctionCount: 3, timeToTarget: 1100, reactionTime: 320 },
      { hit: false, reactionTime: 900, timeToTarget: 900 },
    ]);
    const badResult = computeFlickScore({ records: bad, targetRadius: 40, durationMs: 20000 });
    expect(badResult.overshootRate).toBeCloseTo(2 / 19, 2);
    expect(badResult.score).toBeLessThan(goodResult.score);
    expect(badResult.score).toBeGreaterThanOrEqual(0);
  });

  it("miss rate damages score", () => {
    const hits20 = makeFlick(40, 20);
    const withMisses = makeFlick(40, 20, [
      { hit: false, reactionTime: 800, timeToTarget: 800 },
      { hit: false, reactionTime: 700, timeToTarget: 700 },
    ]);
    const a = computeFlickScore({ records: hits20, targetRadius: 40, durationMs: 10000 });
    const b = computeFlickScore({ records: withMisses, targetRadius: 40, durationMs: 10000 });
    expect(a.accuracy).toBe(1);
    expect(b.accuracy).toBeCloseTo(0.9, 3);
    expect(b.score).toBeLessThan(a.score);
  });
});

describe("scoring: tracking", () => {
  function linearTrack(times: number[], cursorSpeed = 140): TrackingSample[] {
    return times.map((t) => ({ t, cursorX: t * cursorSpeed / 1000, cursorY: 0, targetX: t * 0.1, targetY: 0 }));
  }

  it("uses time rather than frame count for the same motion at different sampling rates", () => {
    const uniform = Array.from({ length: 51 }, (_, i) => i * 20);
    const uneven = [
      ...Array.from({ length: 101 }, (_, i) => i * 5),
      ...Array.from({ length: 25 }, (_, i) => 520 + i * 20),
    ];
    const steady = computeTrackingScore({ samples: linearTrack(uniform), targetRadius: 26, seed: 1 });
    const varied = computeTrackingScore({ samples: linearTrack(uneven), targetRadius: 26, seed: 1 });
    expect(varied.sampleCount).toBe(126);
    expect(varied.durationMs).toBe(1000);
    expect(varied.avgError).toBeCloseTo(20, 6);
    expect(varied.medianError).toBeCloseTo(20, 6);
    expect(varied.p95Error).toBeCloseTo(38, 6);
    expect(varied.errorStd).toBeCloseTo(40 / Math.sqrt(12), 6);
    expect(varied.coverage).toBeCloseTo(0.65, 6);
    expect(varied.velocityDiffRatio).toBeCloseTo(0.4, 6);
    expect(varied.jitter).toBeCloseTo(40, 6);
    expect(varied.score).toBeCloseTo(steady.score, 6);
  });

  it("gives no velocity matching credit for moving at the same speed in the opposite direction", () => {
    const samples = linearTrack([0, 20, 40], -100);
    const result = computeTrackingScore({ samples, targetRadius: 26, seed: 1 });
    expect(result.velocityDiffRatio).toBeCloseTo(2, 6);
    expect(result.breakdown.velocityMatching).toBe(0);
  });

  it("gives no score when there is no measured interval", () => {
    const result = computeTrackingScore({ samples: linearTrack([20, 20]), targetRadius: 26, seed: 1 });
    expect(result.sampleCount).toBe(2);
    expect(result.durationMs).toBe(0);
    expect(result.score).toBe(0);
  });

  it("does not overweight a short burst of jitter with densely sampled frames", () => {
    const times = [
      ...Array.from({ length: 41 }, (_, i) => i * 5),
      ...Array.from({ length: 20 }, (_, i) => 240 + i * 40),
    ];
    const samples = times.map((t) => ({ t, cursorX: Math.min(t, 200) * 0.1, cursorY: 0, targetX: 0, targetY: 0 }));
    const result = computeTrackingScore({ samples, targetRadius: 26, seed: 1 });
    expect(result.jitter).toBe(0);
    expect(result.breakdown.noise).toBe(100);
    expect(result.avgError).toBeCloseTo(18, 6);
  });

  it("preserves frame counting and speed matching for a session using old scores", () => {
    const samples = linearTrack([0, 150, 300], -100);
    const legacy = computeTrackingScore({ samples, targetRadius: 26, seed: 1, method: "frames" });
    expect(legacy.coverage).toBe(1 / 3);
    expect(legacy.avgError).toBe(30);
    expect(legacy.breakdown.velocityMatching).toBe(100);
  });

  function circleSamples(err: number, count: number): TrackingSample[] {
    const out: TrackingSample[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const tx = 500 + Math.cos(angle) * 200;
      const ty = 300 + Math.sin(angle) * 200;
      // 准星偏向目标一个固定误差方向
      const cx = tx + err;
      const cy = ty;
      out.push({
        t: i * 16.7,
        cursorX: cx,
        cursorY: cy,
        targetX: tx,
        targetY: ty,
      });
    }
    return out;
  }

  it("small error beats large error", () => {
    const good = computeTrackingScore({ samples: circleSamples(5, 300), targetRadius: 26, seed: 1 });
    const bad = computeTrackingScore({ samples: circleSamples(60, 300), targetRadius: 26, seed: 2 });
    expect(good.score).toBeGreaterThan(85);
    expect(bad.score).toBeLessThan(40);
    expect(good.avgError).toBeLessThan(bad.avgError);
    expect(good.coverage).toBe(1);
    expect(bad.coverage).toBe(0);
  });

  it("supports empty sample", () => {
    const r = computeTrackingScore({ samples: [], targetRadius: 26, seed: 3 });
    expect(r.score).toBe(0);
    expect(r.velocityDiffRatio).toBe(0);
    expect(Object.values(r.breakdown).every((score) => score === 0)).toBe(true);
  });
});

describe("scoring: micro", () => {
  it("empty micro samples cannot earn points", () => {
    const result = computeMicroScore({ records: [], targetRadius: 8, durationMs: 0 });
    expect(result.score).toBe(0);
    expect(Object.values(result.breakdown).every((score) => score === 0)).toBe(true);
  });
  function microRecords(radius: number, holdErr: number, corrections: number[]): MicroTargetRecord[] {
    return corrections.map((c, i) => ({
      targetId: i,
      targetX: 500,
      targetY: 300,
      targetRadius: radius,
      spawnTime: i * 2000,
      hitTime: i * 2000 + 1200,
      holdStartTime: i * 2000 + 800,
      avgHoldError: holdErr,
      maxHoldError: holdErr * 1.5,
      corrections: c,
      holdMs: 400,
      completionTime: 1200,
    }));
  }

  it("steady hands score higher than jittery ones", () => {
    const steady = computeMicroScore({ records: microRecords(8, 2, [0, 0, 1, 0]), targetRadius: 8, durationMs: 8000 });
    const shaky = computeMicroScore({ records: microRecords(8, 6, [4, 5, 3, 5]), targetRadius: 8, durationMs: 8000 });
    expect(steady.score).toBeGreaterThan(75);
    expect(shaky.score).toBeLessThan(steady.score);
    expect(steady.avgCorrections).toBeLessThan(shaky.avgCorrections);
  });

  it("no constant accuracy bonus: a perfect hold is bounded by the weighted sub-scores", () => {
    // accuracy 不再参与加权（Micro 无 miss 概念）；满分来自精度/速度/稳定性组合
    const perfect = computeMicroScore({
      records: microRecords(8, 0, [0, 0, 0, 0]).map((r) => ({ ...r, completionTime: 900 })),
      targetRadius: 8,
      durationMs: 3600,
    });
    expect(perfect.score).toBeCloseTo(100, 5);
    const degraded = computeMicroScore({ records: microRecords(8, 2, [0, 0, 1, 0]), targetRadius: 8, durationMs: 8000 });
    // 精度不完美时分数明显低于满分，而不是被恒定 accuracy 项垫高
    expect(degraded.score).toBeLessThan(95);
  });
});

describe("overall & penalties", () => {
  it("all zero scores do not earn a consistency bonus", () => {
    expect(computeOverallScore({ flickScore: 0, trackingScore: 0, microScore: 0, penalties: 0 })).toBe(0);
  });
  it("weights: flick/tracking 30%, micro 25%, consistency 15%", () => {
    // 全 100 分、无惩罚 → 100
    const s = computeOverallScore({ flickScore: 100, trackingScore: 100, microScore: 100, penalties: 0 });
    expect(s).toBeCloseTo(100, 6);
    // 一致性扣分体现：三项差很大
    const uneven = computeOverallScore({ flickScore: 100, trackingScore: 100, microScore: 5, penalties: 0 });
    expect(uneven).toBeLessThan(100 * 0.9);
  });

  it("overshoot penalty reduces the total", () => {
    const base = computeOverallScore({ flickScore: 70, trackingScore: 70, microScore: 70, penalties: 0 });
    const p = computePenalties({
      overshootRate: 0.8,
      undershootRate: 0,
      missRate: 0,
      avgCorrections: 0,
    });
    expect(p).toBeCloseTo(0.8 * 8, 6);
    const withPenalty = computeOverallScore({ flickScore: 70, trackingScore: 70, microScore: 70, penalties: p });
    expect(withPenalty).toBeLessThan(base);
    expect(withPenalty).toBeGreaterThanOrEqual(0);
  });

  it("undershoot penalty reduces the total", () => {
    const base = computeOverallScore({ flickScore: 70, trackingScore: 70, microScore: 70, penalties: 0 });
    const p = computePenalties({
      overshootRate: 0,
      undershootRate: 1,
      missRate: 0,
      avgCorrections: 0,
    });
    const withPenalty = computeOverallScore({ flickScore: 70, trackingScore: 70, microScore: 70, penalties: p });
    expect(withPenalty).toBeLessThan(base);
  });

  it("miss rate penalty", () => {
    const missPenalty = computePenalties({ overshootRate: 0, undershootRate: 0, missRate: 0.5, avgCorrections: 0 });
    expect(missPenalty).toBeCloseTo(6, 6);
  });
});
