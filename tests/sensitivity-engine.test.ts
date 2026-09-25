import { describe, it, expect } from "vitest";
import { SensitivitySearch, ROUND_STEPS } from "../lib/sensitivity-engine";
import { labelFor } from "../lib/sensitivity-engine";
import { clampSensitivity, roundSensitivity } from "../lib/mouse-math";

function fakeFlick(score: number) {
  return {
    score,
    overshootRate: 0.1,
    undershootRate: 0.1,
    misses: 0,
    attempts: 20,
    avgCorrections: 1,
    avgTimeToTarget: 500,
    accuracy: 0.9,
  } as never;
}
function fakeTracking(score: number) {
  return { score } as never;
}
function fakeMicro(score: number) {
  return { score, avgCorrections: 1 } as never;
}

/** 进入下一轮候选（currentRound 为 0 时先初始化） */
function stepRound(search: SensitivitySearch): number[] | null {
  if (search.currentRound === 0) return search.initialCandidates();
  return search.nextRound();
}

describe("candidate generation", () => {
  it("round 1 = base × [0.8, 1, 1.2]", () => {
    const search = new SensitivitySearch(0.35, 800, "standard");
    const c = search.initialCandidates();
    expect(c).toHaveLength(3);
    expect(c[0]).toBeCloseTo(0.28, 3);
    expect(c[1]).toBeCloseTo(0.35, 3);
    expect(c[2]).toBeCloseTo(0.42, 3);
  });

  it("steps shrink over rounds", () => {
    expect(ROUND_STEPS).toEqual([0.2, 0.12, 0.08, 0.05, 0.03]);
    const search = new SensitivitySearch(0.35, 800, "standard");
    expect(search.stepFor(1)).toBe(0.2);
    expect(search.stepFor(2)).toBe(0.12);
    expect(search.stepFor(5)).toBe(0.03);
  });

  it("clamps candidates to valid range and dedupes", () => {
    expect(clampSensitivity(0.001)).toBe(0.05);
    expect(clampSensitivity(9)).toBe(5);
    expect(roundSensitivity(0.333333)).toBe(0.333);
  });
});

describe("search update", () => {
  /** 模拟一轮：完成所有候选，best 返回对应 sens */
  function completeRound(
    search: SensitivitySearch,
    sensList: number[],
    pickBest: (s: number) => number
  ): void {
    for (const s of sensList) {
      const f = pickBest(s);
      search.completeCandidate(s, {
        flick: fakeFlick(f),
        tracking: fakeTracking(f),
        micro: fakeMicro(f),
      });
    }
  }

  it("moves center toward the best candidate", () => {
    const search = new SensitivitySearch(0.35, 800, "standard");
    const r1 = search.initialCandidates(); // 0.28, 0.35, 0.42
    // 让 0.42 明显最好
    completeRound(search, r1, (s) => (s === 0.42 ? 95 : s === 0.35 ? 80 : 70));
    const best = search.bestCandidate();
    expect(best?.sensitivity).toBe(0.42);

    const next = search.nextRound();
    expect(next).not.toBeNull();
    if (!next) return;
    // 中心被拉向 0.42 一侧：中心 > base，且新候选上探 >0.4，步长缩小为 12%
    expect(next[1]).toBeGreaterThan(0.35);
    expect(next[2]).toBeGreaterThan(0.4);
    expect(search.stepFor(2)).toBe(0.12);
  });

  it("identifies direction when low sens is best and narrows over rounds", () => {
    const search = new SensitivitySearch(0.35, 800, "standard");
    let center = 0.35;
    let round = 0;
    const seen: number[] = [];
    while (!search.isDone() && round < 6) {
      let cands: number[];
      if (round === 0) {
        cands = search.initialCandidates();
      } else {
        const n = search.nextRound();
        if (!n) break;
        cands = n;
      }
      round++;
      // 低灵敏度（越往低分越高）
      completeRound(search, cands, (s) => 100 - Math.abs(s - 0.25) * 60);
      center = cands[0];
      seen.push(center);
    }
    const best = search.bestCandidate();
    expect(best).not.toBeNull();
    // 中心应逐渐向 0.25 收敛：越往后候选越低
    expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]);
    // 收敛或到达最大轮数后结束
    expect(round).toBeLessThanOrEqual(4);
  });

  it("stops early when the center stops moving (converged)", () => {
    const search = new SensitivitySearch(0.35, 800, "standard");
    const r1 = search.initialCandidates();
    // 三人都基本一样好，中心就是 base 本身 → 第二轮中心 ≈ base → 收敛
    completeRound(search, r1, () => 85);
    let cands: number[] | null = search.nextRound();
    expect(cands).not.toBeNull(); // 第一轮结束允许继续（previousCenter 为 null）
    if (!cands) return;
    completeRound(search, cands, () => 86);
    // 触发收敛判定
    cands = search.nextRound();
    expect(cands).toBeNull();
    expect(search.isDone()).toBe(true);
  });
});

describe("recommendation", () => {
  it("refuses a recommendation when every candidate has zero weight", () => {
    const search = new SensitivitySearch(0.35, 800, "quick");
    for (const sens of search.initialCandidates()) {
      search.completeCandidate(sens, { flick: fakeFlick(0), tracking: fakeTracking(0), micro: fakeMicro(0) });
    }
    expect(search.recommend.bind(search)).toThrow("有效测试成绩不足");
  });
  function runToEnd(sens: number, dpi: number, picker: (s: number) => number) {
    const search = new SensitivitySearch(sens, dpi, "quick");
    let guard = 0;
    while (!search.isDone() && guard < 6) {
      guard++;
      const cands = stepRound(search);
      if (!cands) break;
      for (const s of cands) {
        const f = picker(s);
        search.completeCandidate(s, {
          flick: fakeFlick(f),
          tracking: fakeTracking(f),
          micro: fakeMicro(f),
        });
      }
    }
    return search.recommend();
  }

  it("recommendation sits inside the tested range and the range is sane", () => {
    const rec = runToEnd(0.35, 800, (s) => 100 - Math.abs(s - 0.32) * 80);
    expect(rec.sensitivity).toBeGreaterThan(0.25);
    expect(rec.sensitivity).toBeLessThan(0.45);
    expect(rec.rangeMin).toBeLessThanOrEqual(rec.sensitivity);
    expect(rec.rangeMax).toBeGreaterThanOrEqual(rec.sensitivity);
    expect(rec.rangeMin).toBeGreaterThan(0.1);
    expect(rec.rangeMax).toBeLessThan(1);
    expect(rec.dpi).toBe(800);
    expect(rec.eDpi).toBeCloseTo(rec.sensitivity * 800, 0);
  });

  it("recommendation is pulled toward the higher-scoring region", () => {
    // 最优方向在低灵敏度 → 推荐值应低于 base
    const rec = runToEnd(0.35, 800, (s) => 100 - Math.abs(s - 0.26) * 50);
    expect(rec.sensitivity).toBeLessThan(0.35);
  });

  it("confidence label mapping", () => {
    expect(labelFor(90)).toBe("High");
    expect(labelFor(75)).toBe("Medium-High");
    expect(labelFor(60)).toBe("Medium");
    expect(labelFor(40)).toBe("Low");
  });

  it("throws when no candidate finished", () => {
    const search = new SensitivitySearch(0.35, 800, "standard");
    expect(() => search.recommend()).toThrow();
  });
});
