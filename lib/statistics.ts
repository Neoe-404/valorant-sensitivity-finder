/**
 * 轻量级统计工具函数。
 * 刻意不引入任何重量级数学库。
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 总体标准差 */
export function standardDeviation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return Math.sqrt(sum / n);
}

/** 变异系数 CV（标准差/均值），0 表示完全一致 */
export function cv(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return standardDeviation(values) / m;
}

export function variance(values: number[]): number {
  const s = standardDeviation(values);
  return s * s;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 归一化到 0~1（max===min 时返回 1） */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return clamp((value - min) / (max - min), 0, 1);
}

/** 线性映射 */
export function linearMap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return outMin + normalize(value, inMin, inMax) * (outMax - outMin);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const a = [...values].sort((x, y) => x - y);
  const idx = clamp((p / 100) * (a.length - 1), 0, a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** 向量长度 */
export function hypot2(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

export function roundTo(value: number, decimals = 3): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

/** 各分数是否内部稳定：输入三个测试分数，输出 0~100 的一致性分数 */
export function consistencyAcross(flick: number, tracking: number, micro: number): number {
  // 三个测试分数差距越大约不稳定
  const spread = standardDeviation([flick, tracking, micro]);
  return clamp(100 * (1 - spread / 45), 0, 100);
}
