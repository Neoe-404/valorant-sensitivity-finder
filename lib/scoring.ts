/**
 * 评分引擎：把原始鼠标测试数据转换为 0~100 分。
 *
 * 设计原则：
 * 1. 所有输入都是真实记录（路径、时间、误差），不是随机数。
 * 2. 每个测试的原始指标都有清晰对应的分数段，注释说明阈值含义。
 * 3. 综合分 = Flick 30% + Tracking 30% + Micro 25% + Consistency 15% - Penalties。
 *
 * 阈值基线（针对 Flick 目标半径 ~36px、Tracking 半径 ~26px、Micro 半径 ~8px 调校）：
 * - 平均到达时间 380ms 视为优秀，每慢 6ms 扣 1 分；
 * - 平均反应 160ms 视为优秀，每慢 4ms 扣 1 分；
 * - Tracking 平均误差为 1.6×目标半径时得 0 分；
 * - Micro 平均 hold 误差为目标半径的 0.9 倍时得 0 分。
 */

import {
  mean,
  median,
  standardDeviation,
  clamp,
  cv,
  percentile,
  consistencyAcross,
} from "./statistics";
import type {
  FlickResult,
  FlickTargetRecord,
  MicroResult,
  MicroTargetRecord,
  TrackingResult,
  TrackingSample,
} from "@/types";

/* ================= Flick ================= */

export interface FlickScoringInput {
  records: FlickTargetRecord[];
  targetRadius: number;
  durationMs: number;
}

export function computeFlickScore(input: FlickScoringInput): FlickResult {
  const { records, durationMs } = input;
  const total = records.length;
  const hits = records.filter((r) => r.hit);
  const misses = total - hits.length;
  const accuracy = total === 0 ? 0 : hits.length / total;

  const ttts = hits.map((r) => r.timeToTarget);
  const reactions = hits.map((r) => r.reactionTime);
  const effs = hits.map((r) => Math.min(1, r.idealDistance / Math.max(1, r.totalMouseDistance)));
  const corrections = records.map((r) => r.correctionCount);
  const overshootRate = hits.length === 0 ? 0 : hits.filter((r) => r.overshoot).length / hits.length;
  const undershootRate =
    hits.length === 0 ? 0 : hits.filter((r) => r.undershoot).length / hits.length;

  const avgTTT = mean(ttts);
  const avgReaction = mean(reactions);
  const avgEff = mean(effs);
  const timeCv = cv(ttts);
  const avgCorr = mean(corrections);

  // --- 分项分 ---
  const accuracyScore = accuracy * 100;
  // 到达速度：380ms 满分，每 6ms 扣 1 分
  const speedScore = hits.length ? clamp(100 - (avgTTT - 380) / 6, 0, 100) : 0;
  // 反应：160ms 满分，每 4ms 扣 1 分
  const reactionScore = hits.length ? clamp(100 - (avgReaction - 160) / 4, 0, 100) : 0;
  // 路径效率：直线 = 100，弯弯绕绕 = 低
  const efficiencyScore = avgEff * 100;
  // 一致性：到达时间 CV 0 → 100 分，CV 0.6 → 0 分
  const consistency = hits.length ? clamp(100 * (1 - timeCv / 0.6), 0, 100) : 0;

  // --- 汇总 + 惩罚 ---
  const raw =
    accuracyScore * 0.28 +
    speedScore * 0.22 +
    reactionScore * 0.12 +
    efficiencyScore * 0.18 +
    consistency * 0.2;
  const penalty =
    overshootRate * 16 + undershootRate * 12 + clamp(avgCorr - 1.2, 0, 10) * 4;
  const score = clamp(raw - penalty, 0, 100);

  return {
    attempts: total,
    hits: hits.length,
    misses,
    accuracy,
    avgReactionTime: avgReaction,
    avgTimeToTarget: avgTTT,
    medianTimeToTarget: median(ttts),
    avgEfficiency: avgEff,
    overshootRate,
    undershootRate,
    avgCorrections: avgCorr,
    consistency,
    score,
    breakdown: {
      accuracy: accuracyScore,
      speed: speedScore,
      reaction: reactionScore,
      efficiency: efficiencyScore,
      consistency,
    },
    records,
    timestamp: Date.now(),
    durationMs,
  };
}

/* ================= Tracking ================= */

export interface TrackingScoringInput {
  samples: TrackingSample[];
  targetRadius: number;
  seed: number;
}

export function computeTrackingScore(input: TrackingScoringInput): TrackingResult {
  const { samples, targetRadius } = input;
  const n = samples.length;
  if (n === 0) {
    return emptyTracking(input);
  }

  const errors = samples.map((s) => s.error);
  const avgError = mean(errors);
  const medianError = median(errors);
  const p95Error = percentile(errors, 95);
  const errorStd = standardDeviation(errors);
  const coverage = samples.filter((s) => s.inside).length / n;

  // 速度匹配：|cursorSpeed - targetSpeed| / max(targetSpeed, 8)
  let velSum = 0;
  let velCount = 0;
  for (const s of samples) {
    const denom = Math.max(s.targetSpeed, 8);
    velSum += Math.abs(s.cursorSpeed - s.targetSpeed) / denom;
    velCount++;
  }
  const velocityDiffRatio = velCount === 0 ? 0 : velSum / velCount;

  // 抖动：误差随时间的变化速度 px/s（取 p75，避免个别帧干扰）
  const jitterDeltas: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt <= 0) continue;
    jitterDeltas.push(Math.abs(samples[i].error - samples[i - 1].error) / dt);
  }
  const jitter = percentile(jitterDeltas, 75);

  // --- 分项 ---
  // 平均误差：0 → 100 分，1.6×radius → 0 分（线性）
  const errorScore = clamp(100 * (1 - avgError / (targetRadius * 1.6)), 0, 100);
  const medianErrorScore = clamp(100 * (1 - medianError / (targetRadius * 1.2)), 0, 100);
  const coverageScore = coverage * 100;
  // 稳定性：误差波动越小越好，标准差 1.2×radius → 0 分
  const stabilityScore = clamp(100 * (1 - errorStd / (targetRadius * 1.2)), 0, 100);
  // 速度匹配：比率 0 → 100 分，比率 1.1 → 0 分
  const velocityScore = clamp(100 * (1 - velocityDiffRatio / 1.1), 0, 100);
  // 噪声：抖动 1.1×radius px/s → 0 分
  const noiseScore = clamp(100 * (1 - jitter / (targetRadius * 1.1)), 0, 100);

  const score = clamp(
    errorScore * 0.25 +
      medianErrorScore * 0.15 +
      coverageScore * 0.2 +
      stabilityScore * 0.15 +
      velocityScore * 0.15 +
      noiseScore * 0.1,
    0,
    100
  );

  return {
    durationMs: n > 0 ? samples[n - 1].t - samples[0].t : 0,
    sampleCount: n,
    avgError,
    medianError,
    p95Error,
    errorStd,
    coverage,
    velocityDiffRatio,
    jitter,
    score,
    breakdown: {
      error: errorScore,
      medianError: medianErrorScore,
      coverage: coverageScore,
      stability: stabilityScore,
      velocityMatching: velocityScore,
      noise: noiseScore,
    },
    timestamp: Date.now(),
    seed: input.seed,
  };
}

function emptyTracking(input: TrackingScoringInput): TrackingResult {
  return {
    durationMs: 0,
    sampleCount: 0,
    avgError: 0,
    medianError: 0,
    p95Error: 0,
    errorStd: 0,
    coverage: 0,
    velocityDiffRatio: 1,
    jitter: 0,
    score: 0,
    breakdown: {
      error: 0,
      medianError: 0,
      coverage: 0,
      stability: 0,
      velocityMatching: 0,
      noise: 0,
    },
    timestamp: Date.now(),
    seed: input.seed,
  };
}

/* ================= Micro ================= */

export interface MicroScoringInput {
  records: MicroTargetRecord[];
  targetRadius: number;
  durationMs: number;
}

export function computeMicroScore(input: MicroScoringInput): MicroResult {
  const { records, targetRadius, durationMs } = input;
  const total = records.length;
  const accuracy = total === 0 ? 0 : 1;

  const holdErrors = records.map((r) => r.avgHoldError);
  const completions = records.map((r) => r.completionTime);
  const corrections = records.map((r) => r.corrections);
  const avgHoldError = mean(holdErrors);
  const avgCompletion = mean(completions);
  const avgCorr = mean(corrections);
  const stability = total ? clamp(100 * (1 - cv(holdErrors) / 0.6), 0, 100) : 0;

  const accuracyScore = accuracy * 100;
  // 精度：hold 平均误差为半径的 0.9 倍 → 0 分
  const precisionScore = total ? clamp(100 * (1 - avgHoldError / (targetRadius * 0.9)), 0, 100) : 0;
  // 速度：900ms 满分，每慢 8ms 扣 1 分
  const speedScore = total ? clamp(100 - (avgCompletion - 900) / 8, 0, 100) : 0;
  const correctionPenalty = clamp(avgCorr - 1.5, 0, 10) * 4;

  const score = clamp(
    accuracyScore * 0.3 + precisionScore * 0.35 + speedScore * 0.15 + stability * 0.2 - correctionPenalty,
    0,
    100
  );

  return {
    attempts: total,
    hits: records.length,
    misses: 0,
    accuracy,
    avgHoldError,
    avgCompletionTime: avgCompletion,
    avgCorrections: avgCorr,
    stability,
    score,
    breakdown: {
      accuracy: accuracyScore,
      precision: precisionScore,
      speed: speedScore,
      stability,
    },
    records,
    timestamp: Date.now(),
    durationMs,
  };
}

/* ================= 综合 ================= */

export interface PenaltyInput {
  overshootRate: number;
  undershootRate: number;
  missRate: number;
  avgCorrections: number;
}

/** 综合惩罚项（0~100 分中扣除） */
export function computePenalties(p: PenaltyInput): number {
  const missPenalty = p.missRate * 12;
  const overshootPenalty = p.overshootRate * 8;
  const undershootPenalty = p.undershootRate * 6;
  const correctionPenalty = clamp(p.avgCorrections - 1.6, 0, 8) * 2.5;
  return clamp(missPenalty + overshootPenalty + undershootPenalty + correctionPenalty, 0, 100);
}

export interface OverallInput {
  flickScore: number;
  trackingScore: number;
  microScore: number;
  penalties: number;
}

/**
 * Overall Sensitivity Score：
 * Flick 30% + Tracking 30% + Micro 25% + Consistency 15% - Penalties
 */
export function computeOverallScore(input: OverallInput): number {
  if (input.flickScore === 0 && input.trackingScore === 0 && input.microScore === 0) return 0;
  const consistency = consistencyAcross(input.flickScore, input.trackingScore, input.microScore);
  const raw =
    input.flickScore * 0.3 + input.trackingScore * 0.3 + input.microScore * 0.25 + consistency * 0.15;
  return clamp(raw - input.penalties, 0, 100);
}

/** 返回一致性分（供外部展示/聚合） */
export function consistencyFor(flickScore: number, trackingScore: number, microScore: number): number {
  return consistencyAcross(flickScore, trackingScore, microScore);
}
