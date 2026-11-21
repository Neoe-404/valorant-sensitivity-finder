import { DEFAULT_SETTINGS } from "../types/settings";
import type { CalibrationSummary, CandidateScore, HistoryRecord, PlayerSettings, RecordedTest, SessionSnapshot, TestProgress } from "../types";
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
const label = (value: unknown) => typeof value === "string" && ["Low", "Medium", "Medium-High", "High"].includes(value);
const nonNegative = (value: unknown): value is number => number(value) && value >= 0;
const fraction = (value: unknown) => between(value, 0, 1);
const progressVersion = (value: unknown): value is TestProgress["version"] =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7 || value === 8 || value === 9 || value === 10;

export function parsePlayerSettings(value: unknown): PlayerSettings | null {
  if (!object(value) || !between(value.dpi, 50, 20000) || !Number.isInteger(value.dpi) ||
      !sensitivity(value.baseSensitivity)) return null;
  // 老版本缺少可选偏好时使用默认值，不信任类型断言或无效枚举。
  return {
    ...DEFAULT_SETTINGS,
    dpi: value.dpi,
    baseSensitivity: value.baseSensitivity as number,
    mode: mode(value.mode) ? value.mode as PlayerSettings["mode"] : DEFAULT_SETTINGS.mode,
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
      !number(rec.basisCount) || !Array.isArray(rec.basis) || !rec.basis.every(sensitivity) || typeof rec.reason !== "string" ||
      (rec.hasSeparatedHighScores !== undefined && typeof rec.hasSeparatedHighScores !== "boolean")) return false;
  const profile = value.profile;
  if (!object(profile) || !["flick", "tracking", "micro", "stability", "speed", "precision"].every((key) => score(profile[key]))) return false;
  if (!Array.isArray(value.analysis) || !value.analysis.every((item) => object(item) &&
      typeof item.severity === "string" && ["info", "warn", "good"].includes(item.severity) &&
      typeof item.title === "string" && typeof item.text === "string")) return false;
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

function validCandidateMetrics(metrics: unknown): boolean {
  return metrics === null || (object(metrics) &&
    [metrics.overshootRate, metrics.undershootRate, metrics.missRate, metrics.flickAccuracy].every(fraction) &&
    nonNegative(metrics.avgCorrections) && nonNegative(metrics.avgTimeToTarget));
}

export function isBackupRecord(value: unknown): value is HistoryRecord {
  return isHistoryRecord(value) && /^[a-zA-Z0-9_-]{1,120}$/.test(value.id) &&
    value.snapshot.candidates.every((candidate) => validCandidateMetrics(candidate.metrics ?? null));
}

function validImportedCandidate(candidate: CandidateScore, rounds: number): boolean {
  const { round, metrics, finished, flickScore, trackingScore, microScore, overallScore } = candidate;
  return Number.isInteger(round) && round <= rounds && candidate.multiplier > 0 &&
    (!finished || [flickScore, trackingScore, microScore, overallScore].every(score)) &&
    validCandidateMetrics(metrics);
}

export function parseResultExport(json: string): SessionSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (!isSessionSnapshot(value)) return null;
  const { id, createdAt, rounds, settings, recommendation, candidates } = value;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id) || !Number.isInteger(createdAt) ||
      createdAt < 0 || !Number.isFinite(new Date(createdAt).getTime()) || !Number.isInteger(rounds) ||
      !Number.isInteger(settings.dpi) || recommendation.dpi !== settings.dpi ||
      recommendation.eDpi !== Math.round(recommendation.sensitivity * settings.dpi)) return null;
  if (!candidates.every((candidate) => validImportedCandidate(candidate, rounds))) return null;
  const uniqueRows = new Set(candidates.map((candidate) => `${candidate.round}-${candidate.sensitivity}`));
  if (uniqueRows.size !== candidates.length) return null;
  const measured = new Set(candidates.filter((candidate) => candidate.finished).map((candidate) => candidate.sensitivity));
  const { basis, basisCount } = recommendation;
  if (!basis.length || basis.length !== basisCount || new Set(basis).size !== basis.length ||
      !basis.every((sensitivity) => measured.has(sensitivity))) return null;
  return value;
}

function isCalibrationSummary(value: unknown): value is CalibrationSummary {
  return object(value) && nonNegative(value.avgMoveSpeed) && nonNegative(value.avgClickDelay) &&
    nonNegative(value.clicks) && Number.isInteger(value.clicks) && fraction(value.hitRate);
}

function isRecordedTest(value: unknown): value is RecordedTest {
  if (!object(value) || !sensitivity(value.sensitivity) || !object(value.measurement) ||
      !score(value.measurement.score)) return false;
  const m = value.measurement;
  if (value.testIndex === 1) return true;
  if (value.testIndex === 2) return nonNegative(m.avgCorrections);
  return value.testIndex === 0 && fraction(m.overshootRate) && fraction(m.undershootRate) &&
    fraction(m.accuracy) && nonNegative(m.avgCorrections) && nonNegative(m.avgTimeToTarget) &&
    nonNegative(m.attempts) && Number.isInteger(m.attempts) &&
    between(m.misses, 0, m.attempts) && Number.isInteger(m.misses);
}

export function parseTestProgress(value: unknown): TestProgress | null {
  if (!object(value) || !progressVersion(value.version) || typeof value.id !== "string" || !value.id ||
      !object(value.settings) || !mode(value.settings.mode) || !isCalibrationSummary(value.calibration) ||
      !Array.isArray(value.tests) || !value.tests.every(isRecordedTest)) return null;
  const settings = parsePlayerSettings(value.settings);
  if (!settings) return null;
  return { version: value.version, id: value.id, settings, calibration: value.calibration, tests: value.tests };
}

/**
 * 设置表单校验（与 parsePlayerSettings 共享同一套边界规则）。
 * 返回错误消息列表，空数组表示通过。
 */
export function validateSettingsInput(input: { dpi: number; baseSensitivity: number }): string[] {
  const errs: string[] = [];
  const dpi = Number(input.dpi);
  const sens = Number(input.baseSensitivity);
  if (!input.dpi || String(input.dpi).trim() === "" || Number.isNaN(dpi)) {
    errs.push("请输入鼠标 DPI（正整数）");
  } else if (!Number.isInteger(dpi) || dpi < 50 || dpi > 20000) {
    errs.push("DPI 应为 50 ~ 20000 之间的整数");
  }
  if (!input.baseSensitivity || String(input.baseSensitivity).trim() === "" || Number.isNaN(sens)) {
    errs.push("请输入当前 VALORANT 灵敏度");
  } else if (sens < MIN_SENS || sens > MAX_SENS) {
    errs.push(`灵敏度应在 ${MIN_SENS} ~ ${MAX_SENS} 之间`);
  }
  return errs;
}
