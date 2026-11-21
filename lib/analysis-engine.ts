/**
 * 规则引擎：根据真实测试数据生成瞄准画像与文字分析。
 * 第一版不接 AI API，全部规则可解释、阈值有注释。
 */

import { clamp } from "./statistics";
import { bestMeasuredCandidate } from "./result-record";
import type { AimProfile, AnalysisItem, CalibrationSummary, CandidateScore, SessionSnapshot } from "@/types";

export interface AnalysisInput {
  baseSensitivity: number;
  best: CandidateScore;
  rounds: number;
  calibration: CalibrationSummary | null;
}

const OVERSHOOT_THRESHOLD = 0.3;
const UNDERSHOOT_THRESHOLD = 0.3;

function recommendationDirection(base: number, recommended: number): AnalysisItem {
  const change = (recommended - base) / base;
  const value = recommended.toFixed(3);
  if (Math.abs(change) < 0.03) {
    return {
      severity: "info",
      title: "推荐值接近当前灵敏度",
      text: `可先在游戏内试用 ${value}，与当前的 ${base.toFixed(3)} 比较手感。`,
    };
  }
  const direction = change > 0 ? "提高" : "降低";
  return {
    severity: "info",
    title: `建议${direction}灵敏度`,
    text: `推荐先试用 ${value}，比当前的 ${base.toFixed(3)} ${direction}约 ${Math.round(Math.abs(change) * 100)}%。`,
  };
}

/** 从保存的成绩和推荐值生成当前解读，也适用于较早的记录。 */
export function analyzeResult(snapshot: SessionSnapshot) {
  const { candidates, settings, rounds, recommendation } = snapshot;
  const best = bestMeasuredCandidate(candidates);
  const emptyCalibration = snapshot.calibration?.clicks === 0;
  const calibration = emptyCalibration ? null : snapshot.calibration;
  const input = best ? { best, baseSensitivity: settings.baseSensitivity, rounds, calibration } : null;
  return {
    best,
    calibration,
    profile: input?.best.metrics && emptyCalibration
      ? { ...snapshot.profile, speed: buildAimProfile(input).speed }
      : snapshot.profile,
    analysis: input
      ? buildAnalysis(input, recommendation.sensitivity)
      : [recommendationDirection(settings.baseSensitivity, recommendation.sensitivity)],
  };
}

/** 生成 0~100 瞄准画像（雷达图数据） */
export function buildAimProfile(input: AnalysisInput): AimProfile {
  const { best, calibration } = input;
  const flick = best.flickScore ?? 0;
  const tracking = best.trackingScore ?? 0;
  const micro = best.microScore ?? 0;
  const stability = best.consistencyScore ?? 0;
  const metrics = best.metrics;

  // 速度画像：来自真实平均到达时间（380ms 满分，每 6ms 扣 1 分），
  // 并用校准期的鼠标移动速度作微调（基准越快，上限略低也更真实）。
  let speed = 60;
  if (metrics && metrics.flickAccuracy > 0) {
    speed = clamp(100 - (metrics.avgTimeToTarget - 380) / 6, 0, 100);
  } else if (metrics) {
    speed = 0;
  }
  if (calibration && calibration.clicks > 0 && calibration.avgMoveSpeed > 0 && metrics && metrics.flickAccuracy > 0) {
    const bonus = clamp((calibration.avgMoveSpeed - 600) / 30, -15, 15);
    speed = clamp(speed + bonus, 5, 100);
  }

  // 精度画像：Flick 命中率 ×0.6 + Micro 分数 ×0.4
  const accuracy = metrics ? metrics.flickAccuracy * 100 : 50;
  const precision = clamp(accuracy * 0.6 + micro * 0.4, 0, 100);

  return {
    flick: Math.round(flick),
    tracking: Math.round(tracking),
    micro: Math.round(micro),
    stability: Math.round(stability),
    speed: Math.round(speed),
    precision: Math.round(precision),
  };
}

/** 根据真实数据生成规则型文字分析 */
export function buildAnalysis(input: AnalysisInput, recommendedSensitivity: number): AnalysisItem[] {
  const { best, baseSensitivity, rounds } = input;
  const flick = best.flickScore ?? 0;
  const tracking = best.trackingScore ?? 0;
  const micro = best.microScore ?? 0;
  const consistency = best.consistencyScore ?? 0;
  const m = best.metrics;
  const overshootRate = m?.overshootRate ?? 0;
  const undershootRate = m?.undershootRate ?? 0;
  const items = [recommendationDirection(baseSensitivity, recommendedSensitivity)];

  // 2. 过冲 / 欠冲（来自真实命中记录）
  if (overshootRate > OVERSHOOT_THRESHOLD) {
    items.push({
      severity: "warn",
      title: "存在明显过冲",
      text: `你的瞄准中出现了较明显的过冲（命中前越过目标的比例 ${Math.round(
        overshootRate * 100
      )}%）。可练习在接近目标时减速。`,
    });
  }
  if (undershootRate > UNDERSHOOT_THRESHOLD) {
    items.push({
      severity: "warn",
      title: "存在明显欠冲",
      text: `你较频繁地出现未一次到位的情况（${Math.round(
        undershootRate * 100
      )}%）。可练习减少到位前的停顿。`,
    });
  }
  if (m && m.flickAccuracy >= 0.7 && overshootRate <= OVERSHOOT_THRESHOLD && undershootRate <= UNDERSHOOT_THRESHOLD) {
    items.push({
      severity: "good",
      title: "一次性到位能力不错",
      text: "过冲与欠冲的比例都处于健康范围，你的主要问题不在初始定位阶段。",
    });
  }

  // 3. Tracking vs Micro 对比
  if (tracking < 65 && micro >= 75) {
    items.push({
      severity: "warn",
      title: "跟踪稳定性待提升",
      text: "你的静态目标（Micro）控制不错，但连续跟踪移动目标时的稳定性还有提升空间。建议在靶场里练习跟枪与预判。",
    });
  } else if (tracking >= 75 && micro < 65) {
    items.push({
      severity: "warn",
      title: "微调精度待提升",
      text: "跟枪成绩较好，微调得分偏低。可以练习小范围移动和稳定保持。",
    });
  }

  // 4. 一致性
  if (consistency < 60) {
    items.push({
      severity: "warn",
      title: "各项得分差异较大",
      text: "甩枪、跟枪和微调的得分差距较大。可以在候选成绩表中对比各项表现。",
    });
  }

  // 5. 轮次越少，置信度越有限
  if (rounds < 3) {
    items.push({
      severity: "info",
      title: "测试轮次较少",
      text: `当前仅完成 ${rounds} 轮搜索。轮次越多，推荐区间越可靠；你也可以之后再测一轮来追踪变化。`,
    });
  }

  // 6. 快但刹不住车
  if (flick >= 70 && overshootRate > OVERSHOOT_THRESHOLD) {
    items.push({
      severity: "info",
      title: "快，但需要刹住车",
      text: "反应和到位很快，但刹车（防过冲）不足。练习在接近目标末端时主动降低鼠标速度。",
    });
  }

  return items.slice(0, 6);
}
