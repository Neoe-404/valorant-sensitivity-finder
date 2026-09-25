/**
 * 瞄准画像与分析结果
 */

export interface AimProfile {
  flick: number; // 0~100
  tracking: number;
  micro: number;
  stability: number;
  speed: number;
  precision: number;
}

export type AnalysisSeverity = "good" | "warn" | "info";

export interface AnalysisItem {
  severity: AnalysisSeverity;
  title: string;
  text: string;
}
