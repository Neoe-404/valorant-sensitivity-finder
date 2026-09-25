/**
 * 规则引擎：根据真实测试数据生成瞄准画像与文字分析。
 * 第一版不接 AI API，全部规则可解释、阈值有注释。
 */

import { clamp } from "./statistics";
import type { AimProfile, AnalysisItem, CandidateScore } from "@/types";

export interface AnalysisInput {
  baseSensitivity: number;
  best: CandidateScore;
  rounds: number;
  calibration: { avgMoveSpeed: number; avgClickDelay: number } | null;
}

const OVERSHOOT_THRESHOLD = 0.3;
const UNDERSHOOT_THRESHOLD = 0.3;

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
  if (calibration && calibration.avgMoveSpeed > 0 && metrics && metrics.flickAccuracy > 0) {
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
export function buildAnalysis(input: AnalysisInput): AnalysisItem[] {
  const { best, baseSensitivity, rounds } = input;
  const flick = best.flickScore ?? 0;
  const tracking = best.trackingScore ?? 0;
  const micro = best.microScore ?? 0;
  const consistency = best.consistencyScore ?? 0;
  const m = best.metrics;
  const overshootRate = m?.overshootRate ?? 0;
  const undershootRate = m?.undershootRate ?? 0;
  const items: AnalysisItem[] = [];

  // 1. 方向判断：推荐值与当前灵敏度的相对关系（用最佳候选的相对位置辅助）
  const diff = (best.sensitivity - baseSensitivity) / Math.max(0.0001, baseSensitivity);
  if (Math.abs(diff) < 0.03) {
    items.push({
      severity: "info",
      title: "当前灵敏度方向正确",
      text: `最优候选 ${best.sensitivity.toFixed(3)} 与你现在的灵敏度（${baseSensitivity.toFixed(
        3
      )}）非常接近，说明你目前的方向基本正确，只需微调即可。`,
    });
  } else if (diff > 0) {
    items.push({
      severity: "info",
      title: "建议略微提高灵敏度",
      text: `数据显示最佳成绩出现在更高灵敏度（${best.sensitivity.toFixed(
        3
      )}，相对提升 ${Math.round(diff * 100)}%）下。如果向上调整后没有明显过冲，可以放心使用。`,
    });
  } else {
    items.push({
      severity: "info",
      title: "建议略微降低灵敏度",
      text: `数据显示最佳成绩出现在更低灵敏度（${best.sensitivity.toFixed(
        3
      )}，相对降低 ${Math.round(-diff * 100)}%）下，你的控制更稳定。`,
    });
  }

  // 2. 过冲 / 欠冲（来自真实命中记录）
  if (overshootRate > OVERSHOOT_THRESHOLD) {
    items.push({
      severity: "warn",
      title: "存在明显过冲",
      text: `你的瞄准中出现了较明显的过冲（命中前越过目标的比例 ${Math.round(
        overshootRate * 100
      )}%）。这通常意味着当前灵敏度对你的精细控制来说偏快，可以尝试再降低 5%～8%。`,
    });
  }
  if (undershootRate > UNDERSHOOT_THRESHOLD) {
    items.push({
      severity: "warn",
      title: "存在明显欠冲",
      text: `你较频繁地出现未一次到位的情况（${Math.round(
        undershootRate * 100
      )}%），到位速度偏慢。可以尝试略微提高灵敏度以缩短到位时间。`,
    });
  }
  if (overshootRate <= OVERSHOOT_THRESHOLD && undershootRate <= UNDERSHOOT_THRESHOLD) {
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
      text: "跟枪成绩较好但微调精度偏低，说明你在小范围修正时容易抖动，可以略微降低灵敏度或练习精细控制。",
    });
  }

  // 4. 一致性
  if (consistency < 60) {
    items.push({
      severity: "warn",
      title: "成绩波动较大",
      text: "三项测试成绩差异较大（一致性分低），可能是状态波动或灵敏度不适配。建议保持当前区间再完成一轮测试，避免单次成绩干扰判断。",
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

  if (items.length === 0) {
    items.push({
      severity: "info",
      title: "没有明显短板",
      text: "当前数据未触发明显的问题规则。继续按推荐区间练习即可。",
    });
  }

  return items.slice(0, 6);
}
