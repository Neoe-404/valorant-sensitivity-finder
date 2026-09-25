import { describe, expect, it } from "vitest";
import {
  eDpi,
  sensitivityMultiplier,
  virtualSensitivityScale,
  cmPer360,
  DEGREES_PER_COUNT_PER_SENS,
  VALORANT_H_FOV,
} from "../lib/mouse-math";

describe("mouse-math: eDPI & multiplier", () => {
  it("eDpi = dpi * sensitivity", () => {
    expect(eDpi(800, 0.35)).toBe(280);
    expect(eDpi(1600, 0.175)).toBe(280); // 等效 eDPI
  });

  it("sensitivityMultiplier = candidate / base", () => {
    expect(sensitivityMultiplier(0.28, 0.35)).toBeCloseTo(0.8, 5);
    expect(sensitivityMultiplier(0.42, 0.35)).toBeCloseTo(1.2, 5);
    expect(sensitivityMultiplier(0.35, 0)).toBe(1); // 退化保护
  });

  it("相同物理距离在等效 eDPI 下产生相同位移", () => {
    const a = virtualSensitivityScale(0.35, 800, 1920);
    const b = virtualSensitivityScale(0.175, 1600, 1920);
    // 移动一英寸：1600 DPI 会产生两倍 count，故每 count 倍率应减半。
    expect(800 * a).toBeCloseTo(1600 * b, 8);
    expect(a).toBeCloseTo(0.456699, 5);
    expect(virtualSensitivityScale(0.35, 1600, 1920)).toBeCloseTo(a, 8);
  });

  it("scale 与游戏灵敏度、画布宽度线性相关", () => {
    const s1 = virtualSensitivityScale(0.35, 800, 1920);
    const s2 = virtualSensitivityScale(0.7, 800, 1920); // 2x sens
    expect(s2 / s1).toBeCloseTo(2, 5);
    const s3 = virtualSensitivityScale(0.35, 800, 2560); // 更宽屏
    expect(s3 / s1).toBeCloseTo(2560 / 1920, 5);
  });

  it("0.07°/count 常数：360° 距离符合常见职业值", () => {
    expect(DEGREES_PER_COUNT_PER_SENS).toBeCloseTo(0.07, 3);
    expect(VALORANT_H_FOV).toBe(103);
    // counts for 360° = 360 / (0.07 * sens)，@800DPI 0.35
    const counts = 360 / (DEGREES_PER_COUNT_PER_SENS * 0.35);
    const cm = (counts / 800) * 2.54;
    expect(cm).toBeGreaterThan(35);
    expect(cm).toBeLessThan(60);
    expect(cmPer360(800, 0.35)).toBeCloseTo(cm, 6);
  });

  it("cmPer360 随灵敏度/DPI 反比", () => {
    const a = cmPer360(800, 0.35);
    const b = cmPer360(1600, 0.35);
    expect(a / b).toBeCloseTo(2, 5);
    expect(cmPer360(0, 0.35)).toBe(0);
  });
});
