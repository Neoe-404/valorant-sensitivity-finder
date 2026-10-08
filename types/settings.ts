/**
 * 玩家设置（保存在 localStorage，未来可迁移到 Supabase 用户表）
 */

export type TestMode = "quick" | "standard";

export interface PlayerSettings {
  dpi: number;
  baseSensitivity: number;
  screenWidth: number;
  screenHeight: number;
  mode: TestMode;
  crosshairColor: string;
}

export const TEST_MODES: { value: TestMode; label: string; desc: string }[] = [
  { value: "quick", label: "快速模式", desc: "约 8～12 分钟，3 轮候选" },
  { value: "standard", label: "标准模式", desc: "约 15～20 分钟，4 轮候选，结果更稳定" },
];

export const DEFAULT_SETTINGS: PlayerSettings = {
  dpi: 800,
  baseSensitivity: 0.35,
  screenWidth: 1920,
  screenHeight: 1080,
  mode: "standard",
  crosshairColor: "#52f485",
};
