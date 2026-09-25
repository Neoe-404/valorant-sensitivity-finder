/**
 * 玩家设置（保存在 localStorage，未来可迁移到 Supabase 用户表）
 */

export type SkillLevel = "newbie" | "average" | "skilled" | "high";
export type PlayStyle = "rifle" | "operator" | "duelist" | "controller" | "mixed";
export type Hand = "left" | "right";
export type TestMode = "quick" | "standard";

export interface PlayerSettings {
  dpi: number;
  baseSensitivity: number;
  skillLevel: SkillLevel;
  playstyle: PlayStyle;
  hand: Hand;
  screenWidth: number;
  screenHeight: number;
  mode: TestMode;
  crosshairColor: string;
}

export const SKILL_LEVELS: { value: SkillLevel; label: string }[] = [
  { value: "newbie", label: "新手" },
  { value: "average", label: "普通" },
  { value: "skilled", label: "熟练" },
  { value: "high", label: "高水平" },
];

export const PLAYSTYLES: { value: PlayStyle; label: string }[] = [
  { value: "rifle", label: "Rifle" },
  { value: "operator", label: "Operator" },
  { value: "duelist", label: "Duelist" },
  { value: "controller", label: "Controller" },
  { value: "mixed", label: "Mixed" },
];

export const TEST_MODES: { value: TestMode; label: string; desc: string }[] = [
  { value: "quick", label: "快速模式", desc: "约 8～12 分钟，3 轮候选" },
  { value: "standard", label: "标准模式", desc: "约 15～20 分钟，4 轮候选，结果更稳定" },
];

export const DEFAULT_SETTINGS: PlayerSettings = {
  dpi: 800,
  baseSensitivity: 0.35,
  skillLevel: "average",
  playstyle: "mixed",
  hand: "right",
  screenWidth: 1920,
  screenHeight: 1080,
  mode: "standard",
  crosshairColor: "#52f485",
};
