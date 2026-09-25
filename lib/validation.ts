import { DEFAULT_SETTINGS, PLAYSTYLES, SKILL_LEVELS } from "../types/settings";
import type { HistoryRecord, PlayerSettings, SessionSnapshot } from "../types";
import { MAX_SENS, MIN_SENS } from "./mouse-math";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const between = (value: unknown, min: number, max: number): value is number =>
  number(value) && value >= min && value <= max;
const sensitivity = (value: unknown) => between(value, MIN_SENS, MAX_SENS);
const score = (value: unknown) => between(value, 0, 100);
const mode = (value: unknown) => value === "quick" || value === "standard";
const label = (value: unknown) => ["Low", "Medium", "Medium-High", "High"].includes(String(value));

export function parsePlayerSettings(value: unknown): PlayerSettings | null {
  if (!object(value) || !between(value.dpi, 50, 20000) || !Number.isInteger(value.dpi) ||
      !sensitivity(value.baseSensitivity)) return null;
  // 老版本缺少可选偏好时使用默认值，不信任类型断言或无效枚举。
  return {
    ...DEFAULT_SETTINGS,
    dpi: value.dpi,
    baseSensitivity: value.baseSensitivity as number,
    mode: mode(value.mode) ? value.mode as PlayerSettings["mode"] : DEFAULT_SETTINGS.mode,
    skillLevel: SKILL_LEVELS.some((item) => item.value === value.skillLevel)
      ? value.skillLevel as PlayerSettings["skillLevel"] : DEFAULT_SETTINGS.skillLevel,
    playstyle: PLAYSTYLES.some((item) => item.value === value.playstyle)
      ? value.playstyle as PlayerSettings["playstyle"] : DEFAULT_SETTINGS.playstyle,
    hand: value.hand === "left" ? "left" : "right",
    screenWidth: between(value.screenWidth, 1, 30000) ? value.screenWidth : DEFAULT_SETTINGS.screenWidth,
    screenHeight: between(value.screenHeight, 1, 30000) ? value.screenHeight : DEFAULT_SETTINGS.screenHeight,
    crosshairColor: typeof value.crosshairColor === "string" && /^#[0-9a-f]{6}$/i.test(value.crosshairColor)
      ? value.crosshairColor : DEFAULT_SETTINGS.crosshairColor,
  };
}

export function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!object(value) || typeof value.id !== "string" || !value.id || !number(value.createdAt) ||
      !between(value.rounds, 1, 4) || !object(value.settings) ||
      !between(value.settings.dpi, 50, 20000) || !sensitivity(value.settings.baseSensitivity) ||
      !mode(value.settings.mode)) return false;
  const rec = value.recommendation;
  if (!object(rec) || !sensitivity(rec.sensitivity) || !sensitivity(rec.rangeMin) || !sensitivity(rec.rangeMax) ||
      (rec.rangeMin as number) > (rec.sensitivity as number) || (rec.rangeMax as number) < (rec.sensitivity as number) ||
      !between(rec.dpi, 50, 20000) || !number(rec.eDpi) || !score(rec.confidence) || !label(rec.confidenceLabel) ||
      !number(rec.basisCount) || !Array.isArray(rec.basis) || !rec.basis.every(sensitivity) || typeof rec.reason !== "string") return false;
  const profile = value.profile;
  if (!object(profile) || !["flick", "tracking", "micro", "stability", "speed", "precision"].every((key) => score(profile[key]))) return false;
  if (!Array.isArray(value.analysis) || !value.analysis.every((item) => object(item) &&
      ["info", "warn", "good"].includes(String(item.severity)) && typeof item.title === "string" && typeof item.text === "string")) return false;
  if (!Array.isArray(value.candidates) || !value.candidates.every((item) => object(item) &&
      sensitivity(item.sensitivity) && number(item.multiplier) && between(item.round, 1, 4) &&
      typeof item.finished === "boolean" && ["flickScore", "trackingScore", "microScore", "overallScore", "consistencyScore"].every((key) => item[key] === null || score(item[key])))) return false;
  const cal = value.calibration;
  return cal === null || (object(cal) &&
    ["avgMoveSpeed", "avgClickDelay", "clicks"].every((key) => number(cal[key]) && (cal[key] as number) >= 0) && between(cal.hitRate, 0, 1));
}

export function isHistoryRecord(value: unknown): value is HistoryRecord {
  return object(value) && typeof value.id === "string" && typeof value.date === "string" &&
    Number.isFinite(Date.parse(value.date)) && sensitivity(value.recommendedSensitivity) &&
    sensitivity(value.baseSensitivity) && sensitivity(value.rangeMin) && sensitivity(value.rangeMax) &&
    between(value.dpi, 50, 20000) && number(value.eDpi) && between(value.rounds, 1, 4) &&
    ["flick", "tracking", "micro", "overall", "confidence"].every((key) => score(value[key])) &&
    label(value.confidenceLabel) && isSessionSnapshot(value.snapshot) && value.snapshot.id === value.id;
}
