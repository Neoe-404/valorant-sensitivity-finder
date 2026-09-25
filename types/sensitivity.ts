/**
 * 灵敏度搜索 / 候选 / 推荐 / 历史 的数据模型
 */

import type { AimProfile, AnalysisItem } from "./analysis";

/** 从真实原始测试数据派生的关键指标（供规则分析引擎使用，非随机数） */
export interface CandidateMetrics {
  overshootRate: number;
  undershootRate: number;
  missRate: number;
  avgCorrections: number;
  avgTimeToTarget: number;
  flickAccuracy: number;
}

export interface CandidateScore {
  sensitivity: number;
  multiplier: number;
  round: number;
  orderInRound: number;
  testsCompleted: 0 | 1 | 2 | 3;
  flickScore: number | null;
  trackingScore: number | null;
  microScore: number | null;
  consistencyScore: number | null;
  overallScore: number | null;
  /** 0~1，分数离群程度越低置信度越高 */
  confidence: number;
  finished: boolean;
  metrics: CandidateMetrics | null;
}

export type ConfidenceLabel = "Low" | "Medium" | "Medium-High" | "High";

export interface SensitivityRecommendation {
  sensitivity: number;
  rangeMin: number;
  rangeMax: number;
  dpi: number;
  eDpi: number;
  confidence: number; // 0~100
  confidenceLabel: ConfidenceLabel;
  /** 依据的候选数量 */
  basisCount: number;
  /** 参与计算推荐值的候选 */
  basis: number[];
  reason: string;
}

/** 轮次搜索结果：本轮结束后的更新 */
export interface RoundResult {
  round: number;
  candidates: CandidateScore[];
  best: CandidateScore | null;
  nextCenter: number | null;
  step: number;
  done: boolean;
  recommendation: SensitivityRecommendation | null;
}

export interface SessionSnapshot {
  id: string;
  createdAt: number;
  settings: {
    dpi: number;
    baseSensitivity: number;
    mode: string;
  };
  rounds: number;
  candidates: CandidateScore[];
  recommendation: SensitivityRecommendation;
  profile: AimProfile;
  analysis: AnalysisItem[];
  calibration: {
    avgMoveSpeed: number;
    avgClickDelay: number;
    hitRate: number;
    clicks: number;
  } | null;
}

/** 历史记录（History Page 展示用） */
export interface HistoryRecord {
  id: string;
  date: string; // ISO
  dpi: number;
  baseSensitivity: number;
  recommendedSensitivity: number;
  rangeMin: number;
  rangeMax: number;
  eDpi: number;
  flick: number;
  tracking: number;
  micro: number;
  overall: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  rounds: number;
  snapshot: SessionSnapshot;
}
