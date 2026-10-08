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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
