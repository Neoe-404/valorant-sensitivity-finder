/**
 * 鼠标数学工具：
 * - eDPI 计算
 * - Virtual Sensitivity Multiplier
 * - 距离 / 路径长度
 */

export const MIN_SENS = 0.05;
export const MAX_SENS = 5;

/**
 * VALORANT 灵敏度换算常数（社区共识）：
 * - 每 1 个鼠标 count 旋转 ~0.07 × sens 度（sens 1.0 @ 1000DPI 时 360° ≈ 5143 counts）
 * - 水平 FOV 103°（16:9 默认），用于把“角度”投影到屏幕像素
 */
export const DEGREES_PER_COUNT_PER_SENS = 0.07;
export const VALORANT_H_FOV = 103;

/** 360° 旋转所需鼠标物理移动（cm），供设置页/结果页展示真实感标尺 */
export function cmPer360(dpi: number, sensitivity: number): number {
  if (dpi <= 0 || sensitivity <= 0) return 0;
  const counts = 360 / (DEGREES_PER_COUNT_PER_SENS * sensitivity);
  return (counts / dpi) * 2.54;
}

/**
 * 把候选灵敏度换算为“虚拟准星每 count 移动多少屏幕像素”。
 * DPI 决定相同物理移动产生多少 count，不能再次乘进每 count 的倍率。
 * 使用画布 CSS 宽度作线性角度近似；这不是物理级输入校准。
 */
export function virtualSensitivityScale(
  candidateSensitivity: number,
  dpi: number,
  screenWidth: number
): number {
  if (![candidateSensitivity, dpi, screenWidth].every(Number.isFinite) ||
      candidateSensitivity <= 0 || dpi <= 0 || screenWidth <= 0) return 1;
  // 每 count 旋转角度（度）→ 投影到屏幕的像素：
  // 角度(左) × (水平像素 / 水平视场角) = 像素
  return (candidateSensitivity * DEGREES_PER_COUNT_PER_SENS * screenWidth) / VALORANT_H_FOV;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** eDPI = DPI × Sensitivity */
export function eDpi(dpi: number, sensitivity: number): number {
  return dpi * sensitivity;
}

/** 候选灵敏度相对用户当前实际灵敏度的倍率 */
export function sensitivityMultiplier(candidateSensitivity: number, baseSensitivity: number): number {
  if (baseSensitivity <= 0) return 1;
  return candidateSensitivity / baseSensitivity;
}

export function dist2d(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function distSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** 路径总长度，points 为按时间排序的采样点 */
export function pathLength(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist2d(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  return total;
}

export function clampSensitivity(s: number): number {
  return Math.min(MAX_SENS, Math.max(MIN_SENS, s));
}

/** 四舍五入到 3 位小数（VALORANT 灵敏度精度） */
export function roundSensitivity(s: number): number {
  return Math.round(s * 1000) / 1000;
}
