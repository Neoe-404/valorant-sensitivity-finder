import { describe, it, expect } from "vitest";
import { mean, median, standardDeviation, clamp, percentile, cv } from "../lib/statistics";
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
  function circleSamples(radius: number, err: number, count: number): TrackingSample[] {
    const out: TrackingSample[] = [];
    const t0 = Date.now();
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const tx = 500 + Math.cos(angle) * 200;
      const ty = 300 + Math.sin(angle) * 200;
      // 准星偏向目标一个固定误差方向
      const cx = tx + err;
      const cy = ty;
      out.push({
        t: t0 + i * 16.7,
        cursorX: cx,
        cursorY: cy,
        targetX: tx,
        targetY: ty,
        error: Math.hypot(cx - tx, cy - ty),
        inside: Math.hypot(cx - tx, cy - ty) <= radius,
        cursorSpeed: 0,
        targetSpeed: 0,
      });
    }
    return out;
  }

  it("small error beats large error", () => {
    const good = computeTrackingScore({ samples: circleSamples(26, 5, 300), targetRadius: 26, seed: 1 });
    const bad = computeTrackingScore({ samples: circleSamples(26, 60, 300), targetRadius: 26, seed: 2 });
    expect(good.score).toBeGreaterThan(85);
    expect(bad.score).toBeLessThan(40);
    expect(good.avgError).toBeLessThan(bad.avgError);
    expect(good.coverage).toBe(1);
    expect(bad.coverage).toBe(0);
  });

  it("supports empty sample", () => {
    const r = computeTrackingScore({ samples: [], targetRadius: 26, seed: 3 });
    expect(r.score).toBe(0);
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
    expect(steady.score).toBeGreaterThan(80);
    expect(shaky.score).toBeLessThan(steady.score);
    expect(steady.avgCorrections).toBeLessThan(shaky.avgCorrections);
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
