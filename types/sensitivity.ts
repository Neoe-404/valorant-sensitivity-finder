/**
 * 灵敏度搜索 / 候选 / 推荐 / 历史 的数据模型
 */

import type { AimProfile, AnalysisItem } from "./analysis";
import type { CalibrationResult, FlickResult, MicroResult, TrackingResult } from "./aim";
import type { PlayerSettings } from "./settings";

export type CalibrationSummary = Pick<CalibrationResult, "avgMoveSpeed" | "avgClickDelay" | "hitRate" | "clicks">;
export type FlickMeasurement = Pick<FlickResult,
  "score" | "overshootRate" | "undershootRate" | "misses" | "attempts" | "avgCorrections" | "avgTimeToTarget" | "accuracy"
>;
export type TrackingMeasurement = Pick<TrackingResult, "score">;
export type MicroMeasurement = Pick<MicroResult, "score" | "avgCorrections">;

export type RecordedTest = { sensitivity: number } & (
  | { testIndex: 0; measurement: FlickMeasurement }
  | { testIndex: 1; measurement: TrackingMeasurement }
  | { testIndex: 2; measurement: MicroMeasurement }
);

export interface TestProgress {
  /** 2 起跟枪按时间计分，3 起匹配测试难度，4 起微调按时间计分。 */
  version: 1 | 2 | 3 | 4;
  id: string;
  settings: PlayerSettings;
  calibration: CalibrationSummary;
  tests: RecordedTest[];
}

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
  calibration: CalibrationSummary | null;
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
