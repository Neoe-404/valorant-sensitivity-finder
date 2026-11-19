/**
 * Sensitivity Search Engine
 * -------------------------
 * 候选灵敏度搜索策略（启发式加权比较）：
 *
 * 1. 第 1 轮生成 3 个候选：[base×0.8, base, base×1.2]（步长 20%）。
 * 2. 每个候选完成 Flick + Tracking + Micro 三项测试后，得到 overallScore。
 * 3. 一轮结束：以前三名候选（含并列）的分数平方加权平均作为下一轮中心。
 * 4. 逐步缩小搜索范围。已测灵敏度沿用原成绩，某一步没有新值就尝试下一步。
 * 5. 收敛条件：新中心与上轮中心变化 < 1% base，或用完当前模式的搜索步长。
 * 6. 最终推荐：取 bestScore×0.92 以上的候选池，按分数加权求推荐值，
 *    区间 = 候选池 sens 范围夹紧推荐值 ± 最新步长（有最小半宽，单一候选池
 *    保持对称区间）；置信度由区间宽度、top 差距、候选池大小和完成轮数
 *    共同决定，单一候选池或过窄区间会降级。
 */

import { clamp } from "./statistics";
import { bestMeasuredCandidate } from "./result-record";
import { clampSensitivity, roundSensitivity, sensitivityMultiplier } from "./mouse-math";
import {
  computeOverallScore,
  computePenalties,
  consistencyFor,
} from "./scoring";
import type {
  CandidateScore,
  ConfidenceLabel,
  FlickMeasurement,
  MicroMeasurement,
  SensitivityRecommendation,
  TrackingMeasurement,
} from "@/types";

/** 各轮步长（相对中心的比例） */
export const ROUND_STEPS = [0.2, 0.12, 0.08, 0.05, 0.03];
export const MAX_ROUNDS_STANDARD = 4;
export const MAX_ROUNDS_QUICK = 3;
/** 推荐候选池阈值：得分 ≥ 最佳 × 0.92 的候选参与加权 */
export const POOL_SCORE_THRESHOLD = 0.92;
/** 推荐区间最小半宽（绝对灵敏度值），防止零宽区间 */
const MIN_RANGE_HALF_WIDTH = 0.006;
/** 单一候选池的置信度上限（依据不足时最多到 Medium） */
const SINGLE_BASIS_CONFIDENCE_CAP = 55;
/** 区间相对宽度低于该比例视为"过窄"，扣减置信度 */
const NARROW_RANGE_RATIO = 0.01;
const NARROW_RANGE_PENALTY = 20;
const SINGLE_BASIS_PENALTY = 30;

interface CompletedTests {
  flick: FlickMeasurement;
  tracking: TrackingMeasurement;
  micro: MicroMeasurement;
}

export class SensitivitySearch {
  readonly base: number;
  readonly dpi: number;
  readonly maxRounds: number;
  candidates: CandidateScore[] = [];
  currentRound = 0;
  previousCenter: number | null = null;
  private currentStep = 1;
  private done = false;

  constructor(base: number, dpi: number, mode: "quick" | "standard") {
    this.base = clampSensitivity(base);
    this.dpi = dpi;
    this.maxRounds = mode === "quick" ? MAX_ROUNDS_QUICK : MAX_ROUNDS_STANDARD;
  }

  /** 第 1 轮的候选（本轮入口） */
  initialCandidates(): number[] {
    this.currentRound = 1;
    this.currentStep = 1;
    return this.roundCandidates(this.base, this.currentStep);
  }

  /** 按游戏精度取整，再排除同轮重复值和已完成的候选。 */
  private roundCandidates(center: number, stepNumber: number): number[] {
    const step = this.stepFor(stepNumber);
    const candidates = [
      center * (1 - step),
      center,
      center * (1 + step),
    ].map((sens) => roundSensitivity(clampSensitivity(sens)));
    const measured = new Set(
      this.candidates.filter((card) => card.finished).map((card) => card.sensitivity)
    );
    return [...new Set(candidates)].filter((sens) => !measured.has(sens));
  }

  stepFor(round: number): number {
    const idx = clamp(round - 1, 0, ROUND_STEPS.length - 1);
    return ROUND_STEPS[idx];
  }

  /** 生成下一轮候选（未被测试的），返回 null 表示结束 */
  nextRound(): number[] | null {
    if (this.done || !this.bestCandidate()) return null;

    if (this.currentStep >= this.maxRounds) {
      this.done = true;
      return null;
    }

    const center = this.weightedCenter();
    // 收敛判定：中心几乎不再移动
    if (this.previousCenter !== null && Math.abs(center - this.previousCenter) < this.base * 0.01) {
      this.done = true;
      return null;
    }

    // 没有新候选的步长不占用一轮，也不参与推荐区间的计算。
    for (let step = this.currentStep + 1; step <= this.maxRounds; step++) {
      const candidates = this.roundCandidates(center, step);
      if (candidates.length === 0) continue;
      this.previousCenter = center;
      this.currentStep = step;
      this.currentRound += 1;
      return candidates;
    }

    this.done = true;
    return null;
  }

  /** 分数平方加权。第三名并列时纳入同分候选，避免按测试顺序取舍。 */
  private weightedCenter(): number {
    const finished = this.candidates.filter((c) => c.finished && c.overallScore !== null);
    if (finished.length === 0) return this.base;
    const sorted = [...finished].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
    const cutoff = sorted[2]?.overallScore ?? 0;
    const top = sorted.filter((card) => (card.overallScore ?? 0) >= cutoff);
    if (top.length === 1) return top[0].sensitivity;
    const totalWeight = top.reduce((s, c) => s + (c.overallScore ?? 0) * (c.overallScore ?? 0), 0);
    if (totalWeight <= 0) return top[0].sensitivity;
    return (
      top.reduce((s, c) => s + c.sensitivity * ((c.overallScore ?? 0) * (c.overallScore ?? 0) / totalWeight), 0)
    );
  }

  bestCandidate(): CandidateScore | null {
    return bestMeasuredCandidate(this.candidates);
  }

  /** 候选完成三项测试后调用 */
  completeCandidate(sensitivity: number, tests: CompletedTests): CandidateScore {
    const rounded = roundSensitivity(clampSensitivity(sensitivity));
    const existing = this.candidates.find((card) => card.sensitivity === rounded);
    if (existing) return existing;

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

    const card: CandidateScore = {
      sensitivity: rounded,
      multiplier: sensitivityMultiplier(rounded, this.base),
      round: this.currentRound,
      orderInRound: this.candidates.filter((candidate) => candidate.round === this.currentRound).length,
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
    // 置信度在全部候选完成后统一重算（见 recomputeConfidence），
    // 避免"完成得早的候选"在后来者加入后仍保留陈旧值。

    this.candidates.push(card);
    return card;
  }

  /**
   * 全部候选完成后统一重算每个候选的置信度。
   * 候选置信度依赖"与其他候选的分数差距"，必须在最终候选池确定后计算。
   */
  private recomputeConfidence(): void {
    for (const card of this.candidates) {
      if (card.finished) card.confidence = this.candidateConfidence(card);
    }
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
    this.recomputeConfidence();
    const finished = this.candidates.filter((c) => c.finished && c.overallScore !== null);
    const sorted = [...finished].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
    const best = sorted[0];
    if (!best) {
      throw new Error("No completed candidates available for recommendation");
    }
    // 候选池：得分 ≥ best × 0.92
    const pool = sorted.filter((c) => (c.overallScore ?? 0) >= (best.overallScore ?? 0) * POOL_SCORE_THRESHOLD);
    const sensValues = pool.map((c) => c.sensitivity);
    const weights = pool.map((c) => c.overallScore ?? 0);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error("有效测试成绩不足，无法生成推荐。请重新完成测试。");
    }

    const recommended =
      sensValues.reduce((s, v, i) => s + v * (weights[i] / totalWeight), 0);

    const step = this.stepFor(this.currentStep);
    const poolMin = Math.min(...sensValues);
    const poolMax = Math.max(...sensValues);
    // 区间 = 推荐值 ± max(最新步长, 最小半宽)；候选池 ≥2 时才夹紧到池范围，
    // 单一候选时保持对称区间，避免出现"零宽区间 + 高置信"的矛盾。
    const halfWidth = Math.max(step * best.sensitivity, MIN_RANGE_HALF_WIDTH);
    let rangeMin = roundSensitivity(recommended - halfWidth);
    let rangeMax = roundSensitivity(recommended + halfWidth);
    if (pool.length > 1) {
      rangeMin = roundSensitivity(Math.max(poolMin, recommended - halfWidth));
      rangeMax = roundSensitivity(Math.min(poolMax, recommended + halfWidth));
    }
    // 钳制到合法灵敏度范围：越界的区间会被快照校验拒绝，导致结果无法写入历史
    rangeMin = roundSensitivity(clampSensitivity(rangeMin));
    rangeMax = roundSensitivity(clampSensitivity(rangeMax));

    // 置信度：区间越窄、top 差距越大、轮数越多 → 越高；
    // 候选池过小或区间过窄时降级，避免依据不足仍报"高置信"。
    const spread = (rangeMax - rangeMin) / Math.max(0.01, recommended);
    const topGap = sorted.length > 1 ? (best.overallScore ?? 0) - (sorted[1].overallScore ?? 0) : 10;
    const basisPenalty = pool.length < 2 ? SINGLE_BASIS_PENALTY : 0;
    const narrowPenalty =
      (rangeMax - rangeMin) / Math.max(0.0001, recommended) < NARROW_RANGE_RATIO ? NARROW_RANGE_PENALTY : 0;
    let confidence =
      100 - spread * 380 - (topGap < 2 ? 25 : 0) - basisPenalty - narrowPenalty + this.currentRound * 5;
    confidence = clamp(Math.round(confidence), 35, 90);
    if (pool.length < 2) confidence = Math.min(confidence, SINGLE_BASIS_CONFIDENCE_CAP);

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
        Math.round(((rangeMax - rangeMin) / recommended) * 100)
      }%。`,
    };
  }

}

export function labelFor(confidence: number): ConfidenceLabel {
  if (confidence >= 85) return "High";
  if (confidence >= 70) return "Medium-High";
  if (confidence >= 55) return "Medium";
  return "Low";
}
