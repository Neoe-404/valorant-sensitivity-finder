/**
 * 测试通用配置与工具
 */

import type { TestMode } from "@/types";

export const FLICK_RADIUS = 36;
export const TRACKING_RADIUS = 26;
export const MICRO_RADIUS = 8;
export const CAL_RADIUS = 46;

export const TEST_CONFIG = {
  standard: {
    flickTargets: 20,
    trackingDurationMs: 20000,
    microTargets: 12,
    microHoldMs: 400,
    calTargets: 8,
  },
  quick: {
    flickTargets: 12,
    trackingDurationMs: 15000,
    microTargets: 8,
    microHoldMs: 250,
    calTargets: 6,
  },
} as const;

export function configFor(mode: TestMode) {
  return TEST_CONFIG[mode];
}

/** 可复现伪随机数生成器（mulberry32） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export interface SpawnOptions {
  w: number;
  h: number;
  fromX: number;
  fromY: number;
  minFromCursor: number;
  avoidX?: number;
  avoidY?: number;
  minFromAvoid?: number;
  rng: () => number;
}

/** 在画布内随机生成目标位置，尽量远离当前准星（有限尝试后宽松兜底） */
export function randomSpawnPoint(opts: SpawnOptions): { x: number; y: number } {
  const { w, h, fromX, fromY, minFromCursor, rng } = opts;
  const margin = Math.min(120, Math.max(50, Math.min(w, h) * 0.12));
  for (let i = 0; i < 40; i++) {
    const x = margin + rng() * (w - 2 * margin);
    const y = margin + rng() * (h - 2 * margin);
    if (dist(x, y, fromX, fromY) < minFromCursor) continue;
    if (opts.avoidX !== undefined && opts.avoidY !== undefined) {
      const minAvoid = opts.minFromAvoid ?? 150;
      if (dist(x, y, opts.avoidX, opts.avoidY) < minAvoid) continue;
    }
    return { x, y };
  }
  return { x: w * (0.5 + (opts.rng() - 0.5) * 0.5), y: h * (0.5 + (opts.rng() - 0.5) * 0.5) };
}
