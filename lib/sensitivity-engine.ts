/**
 * Sensitivity Search Engine
 * -------------------------
 * 候选灵敏度搜索策略（启发式加权比较）：
 *
 * 1. 第 1 轮生成 3 个候选：[base×0.8, base, base×1.2]（步长 20%）。
 * 2. 每个候选完成 Flick + Tracking + Micro 三项测试后，得到 overallScore。
 * 3. 一轮结束：以 top-3 候选的分数平方加权平均作为下一轮中心（保留探索，
 *    不会因为单次失误立即淘汰某个方向）。
 * 4. 每轮步长递减：[20%, 12%, 8%, 5%, 3%]。
 * 5. 收敛条件：新中心与上轮中心变化 < 1% base，或达到最大轮数。
 * 6. 最终推荐：取 bestScore×0.92 以上的候选池，按分数加权求推荐值，
 *    区间 = 候选池 sens 范围夹紧推荐值 ± 最新步长；置信度由区间宽度、
 *    top 差距和完成轮数共同决定。
 */

import { clamp, mean, roundTo } from "./statistics";
import { clampSensitivity, roundSensitivity, sensitivityMultiplier } from "./mouse-math";
import {
  computeOverallScore,
  computePenalties,
  consistencyFor,
} from "./scoring";
import type { FlickResult, MicroResult, TrackingResult } from "@/types";
import type { CandidateScore, ConfidenceLabel, RoundResult, SensitivityRecommendation } from "@/types";

/** 各轮步长（相对中心的比例） */
export const ROUND_STEPS = [0.2, 0.12, 0.08, 0.05, 0.03];
export const MAX_ROUNDS_STANDARD = 4;
export const MAX_ROUNDS_QUICK = 3;

interface CompletedTests {
  flick: FlickResult;
  tracking: TrackingResult;
  micro: MicroResult;
}

export class SensitivitySearch {
  readonly base: number;
  readonly dpi: number;
  readonly maxRounds: number;
  candidates: CandidateScore[] = [];
  currentRound = 0;
  previousCenter: number | null = null;
  private done = false;

  constructor(base: number, dpi: number, mode: "quick" | "standard") {
    this.base = clampSensitivity(base);
    this.dpi = dpi;
    this.maxRounds = mode === "quick" ? MAX_ROUNDS_QUICK : MAX_ROUNDS_STANDARD;
  }

  /** 第 1 轮的候选（本轮入口） */
  initialCandidates(): number[] {
    this.currentRound = 1;
    return this.roundCandidates(this.base);
  }

  /** 某轮的中心 ± step 生成 3 个候选 */
  private roundCandidates(center: number): number[] {
    const step = this.stepFor(this.currentRound);
    const candidates = [
      roundSensitivity(center * (1 - step)),
      roundSensitivity(center),
      roundSensitivity(center * (1 + step)),
    ];
    // 去重 + 限定范围
    const unique: number[] = [];
    for (const c of candidates) {
      const clamped = clampSensitivity(c);
      if (unique.length === 0 || Math.abs(unique[unique.length - 1] - clamped) > 0.0005) {
        unique.push(clamped);
      }
    }
    return unique;
  }

  stepFor(round: number): number {
    const idx = clamp(round - 1, 0, ROUND_STEPS.length - 1);
    return ROUND_STEPS[idx];
  }

  /** 生成下一轮候选（未被测试的），返回 null 表示结束 */
  nextRound(): number[] | null {
    if (this.done) return null;

    const best = this.bestCandidate();
    if (!best || !best.finished) return null;

    if (this.currentRound >= this.maxRounds) {
      this.done = true;
      return null;
    }

    const center = this.weightedCenter();
    // 收敛判定：中心几乎不再移动
    if (this.previousCenter !== null && Math.abs(center - this.previousCenter) < this.base * 0.01) {
      this.done = true;
      return null;
    }

    this.previousCenter = center;
    this.currentRound += 1;
    return this.roundCandidates(center);
  }

  /** 加权中心：按分数的平方给 top-3 加权，让最优候选占主导（仍保留探索） */
  private weightedCenter(): number {
    const finished = this.candidates.filter((c) => c.finished && c.overallScore !== null);
    if (finished.length === 0) return this.base;
    const sorted = [...finished].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
    const top = sorted.slice(0, 3);
    if (top.length === 1) return top[0].sensitivity;
    const totalWeight = top.reduce((s, c) => s + (c.overallScore ?? 0) * (c.overallScore ?? 0), 0);
    if (totalWeight <= 0) return top[0].sensitivity;
    return (
      top.reduce((s, c) => s + c.sensitivity * ((c.overallScore ?? 0) * (c.overallScore ?? 0) / totalWeight), 0)
    );
  }

  bestCandidate(): CandidateScore | null {
    const finished = this.candidates.filter((c) => c.finished && c.overallScore !== null);
    if (finished.length === 0) return null;
    return [...finished].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))[0];
  }

  /** 候选完成三项测试后调用 */
  completeCandidate(sensitivity: number, tests: CompletedTests): CandidateScore {
    const flickScore = tests.flick.score;
    const trackingScore = tests.tracking.score;
    const microScore = tests.micro.score;
    const penalties = computePenalties({
      overshootRate: tests.flick.overshootRate,
      undershootRate: tests.flick.undershootRate,
      missRate: tests.flick.misses / Math.max(1, tests.flick.attempts),
      avgCorrections: (tests.flick.avgCorrections + tests.micro.avgCorrections) / 2,
    });
    const consistency = consistencyFor(flickScore, trackingScore, microScore);
    const overall = computeOverallScore({ flickScore, trackingScore, microScore, penalties });

    const existing = this.candidates.find(
      (c) => Math.abs(c.sensitivity - sensitivity) < 0.0005
    );
    const card: CandidateScore = {
      sensitivity: roundSensitivity(sensitivity),
      multiplier: sensitivityMultiplier(sensitivity, this.base),
      round: this.currentRound,
      orderInRound: existing ? existing.orderInRound : this.candidates.length,
      testsCompleted: 3,
      flickScore,
      trackingScore,
      microScore,
      consistencyScore: consistency,
      overallScore: overall,
      confidence: 0,
      finished: true,
      metrics: {
        overshootRate: tests.flick.overshootRate,
        undershootRate: tests.flick.undershootRate,
        missRate: tests.flick.misses / Math.max(1, tests.flick.attempts),
        avgCorrections: (tests.flick.avgCorrections + tests.micro.avgCorrections) / 2,
        avgTimeToTarget: tests.flick.avgTimeToTarget,
        flickAccuracy: tests.flick.accuracy,
      },
    };
    card.confidence = this.candidateConfidence(card);

    if (existing) {
      const idx = this.candidates.indexOf(existing);
      this.candidates[idx] = card;
    } else {
      this.candidates.push(card);
    }
    return card;
  }

  private candidateConfidence(card: CandidateScore): number {
    const others = this.candidates.filter(
      (c) => c.finished && c.overallScore !== null && c.sensitivity !== card.sensitivity
    );
    if (others.length === 0) return 0.5;
    const sorted = [...others].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
    const rival = sorted[0].overallScore ?? 0;
    const mine = card.overallScore ?? 0;
    // 领先越多置信度越高
    return clamp(0.5 + (mine - rival) / 20, 0.05, 0.95);
  }

  isDone(): boolean {
    return this.done;
  }

  /**
   * 生成最终推荐（在 done 之后调用）。
   * 推荐值 = 候选池内的按分加权平均值；区间 = 候选池范围夹紧 ± 最新步长。
   */
  recommend(): SensitivityRecommendation {
    const finished = this.candidates.filter((c) => c.finished && c.overallScore !== null);
    const sorted = [...finished].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
    const best = sorted[0];
    if (!best) {
      throw new Error("No completed candidates available for recommendation");
    }
    // 候选池：得分 ≥ best × 0.92
    const pool = sorted.filter((c) => (c.overallScore ?? 0) >= (best.overallScore ?? 0) * 0.92);
    const sensValues = pool.map((c) => c.sensitivity);
    const weights = pool.map((c) => c.overallScore ?? 0);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error("有效测试成绩不足，无法生成推荐。请重新完成测试。");
    }

    const recommended =
      sensValues.reduce((s, v, i) => s + v * (weights[i] / totalWeight), 0);

    const step = this.stepFor(this.currentRound);
    const poolMin = Math.min(...sensValues);
    const poolMax = Math.max(...sensValues);
    const rangeMin = roundSensitivity(Math.max(poolMin, recommended - step * best.sensitivity));
    const rangeMax = roundSensitivity(Math.min(poolMax, recommended + step * best.sensitivity));

    // 置信度：区间越窄、top 差距越大、轮数越多 → 越高
    const spread = (rangeMax - rangeMin) / Math.max(0.01, recommended);
    const topGap = sorted.length > 1 ? (best.overallScore ?? 0) - (sorted[1].overallScore ?? 0) : 10;
    let confidence = 100 - spread * 380 - (topGap < 2 ? 25 : 0) + this.currentRound * 5;
    confidence = clamp(Math.round(confidence), 35, 97);

    return {
      sensitivity: roundSensitivity(recommended),
      rangeMin,
      rangeMax,
      dpi: this.dpi,
      eDpi: Math.round(this.dpi * roundSensitivity(recommended)),
      confidence,
      confidenceLabel: labelFor(confidence),
      basisCount: pool.length,
      basis: sensValues,
      reason: `${pool.length} 个候选灵敏度参与加权（得分 ≥ 最佳×0.92），区间跨度 ${
        Math.round((rangeMax - rangeMin) / recommended * 100) / 1
      }%。`,
    };
  }

  /** 返回本轮结果快照（供 UI/测试） */
  roundResult(): RoundResult {
    const candidates = [...this.candidates];
    return {
      round: this.currentRound,
      candidates,
      best: this.bestCandidate(),
      nextCenter: this.done ? null : roundTo(this.weightedCenter(), 4),
      step: this.stepFor(this.currentRound),
      done: this.done,
      recommendation: this.done && candidates.some((c) => (c.overallScore ?? 0) > 0) ? this.recommend() : null,
    };
  }
}

export function labelFor(confidence: number): ConfidenceLabel {
  if (confidence >= 85) return "High";
  if (confidence >= 70) return "Medium-High";
  if (confidence >= 55) return "Medium";
  return "Low";
}

export function meanOf(values: number[]): number {
  return mean(values);
}
