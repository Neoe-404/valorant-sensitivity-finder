/**
 * localStorage 封装（SSR 安全）。
 * 所有持久化都走这里，避免在业务代码里直接操作 localStorage。
 * 第一版用于本地；键名前缀预留未来迁移 Supabase 时使用同一数据模型。
 */

import type { HistoryRecord, PlayerSettings, SessionSnapshot, TestProgress } from "@/types";
import { isBackupRecord, isHistoryRecord, isSessionSnapshot, parsePlayerSettings, parseResultExport, parseTestProgress } from "./validation";
import { bestMeasuredCandidate, historyRecordFromSnapshot } from "./result-record";

const KEYS = {
  settings: "vsf:settings:v1",
  history: "vsf:history:v1",
  lastSession: "vsf:lastSession:v1",
  testProgress: "vsf:testProgress:v1",
} as const;

/** 历史记录最多保留条数（与 UI 展示上限一致）。 */
const HISTORY_LIMIT = 50;
export const MAX_RESULT_FILE_BYTES = 256 * 1024;
export const MAX_HISTORY_FILE_BYTES = 16 * 1024 * 1024;
const HISTORY_BACKUP_FORMAT = "valorant-sensitivity-finder-history";

export function historyBackup(records: HistoryRecord[]) {
  return { format: HISTORY_BACKUP_FORMAT, version: 1, records };
}

// 仅供当前浏览器页面导航使用；不在 SSR 上缓存用户数据。
let pendingSession: SessionSnapshot | null = null;

function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 写入结果：ok 成功；disabled 存储被禁用/不可用；quota 空间不足（可通过删旧记录恢复）。 */
type SetOutcome = "ok" | "disabled" | "quota";

function isQuotaError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : "";
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

function safeSet(key: string, value: string): SetOutcome {
  try {
    if (typeof window === "undefined") return "disabled";
    window.localStorage.setItem(key, value);
    return "ok";
  } catch (e) {
    return isQuotaError(e) ? "quota" : "disabled";
  }
}

function parse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ---------- Settings ---------- */

export function saveSettings(settings: PlayerSettings): boolean {
  const valid = parsePlayerSettings(settings);
  return valid !== null && safeSet(KEYS.settings, JSON.stringify(valid)) === "ok";
}

export function loadSettings(): PlayerSettings | null {
  return parsePlayerSettings(parse(safeGet(KEYS.settings)));
}

/* ---------- History ---------- */

function parseHistory(raw: string | null): HistoryRecord[] {
  const list = parse(raw);
  return Array.isArray(list) ? list.filter(isHistoryRecord) : [];
}

export function loadHistory(): HistoryRecord[] {
  return parseHistory(safeGet(KEYS.history));
}

export function saveHistory(records: HistoryRecord[]): boolean {
  return records.every(isHistoryRecord) && safeSet(KEYS.history, JSON.stringify(records)) === "ok";
}

/**
 * 写入历史记录。空间不足时丢弃最旧的记录后重试，
 * 直到写成功或仅剩新记录为止（保证本次结果尽量留存，牺牲旧历史）。
 */
function writeHistory(records: HistoryRecord[]): boolean {
  if (!records.every(isHistoryRecord)) return false;
  let outcome = safeSet(KEYS.history, JSON.stringify(records));
  let trimmed = records;
  while (outcome === "quota" && trimmed.length > 1) {
    trimmed = trimmed.slice(0, trimmed.length - 1);
    outcome = safeSet(KEYS.history, JSON.stringify(trimmed));
  }
  return outcome === "ok";
}

export function addHistoryRecord(record: HistoryRecord): HistoryRecord[] | null {
  if (!isHistoryRecord(record)) return null;
  // 写前重新读取已存历史并合并，尽量缓解多标签页并发写入时的后写覆盖。
  const existing = loadHistory();
  const next = [record, ...existing.filter((r) => r.id !== record.id)].slice(0, HISTORY_LIMIT);
  return writeHistory(next) ? next : null;
}

export function deleteHistoryRecord(id: string): HistoryRecord[] | null {
  const next = loadHistory().filter((r) => r.id !== id);
  if (loadLastSession()?.id === id && !clearLastSession()) return null;
  if (!saveHistory(next)) return null;
  return next;
}

export function clearHistory(): HistoryRecord[] | null {
  if (!clearLastSession() || !saveHistory([])) return null;
  return [];
}

export function getHistoryRecord(id: string): HistoryRecord | null {
  return loadHistory().find((r) => r.id === id) ?? null;
}

type ImportError = { status: "invalid" | "too-large" | "active-test" | "full" | "unavailable" };
type ResultImportOutcome = { status: "imported" | "duplicate"; id: string } | ImportError;
type HistoryImportOutcome = ResultImportOutcome | { status: "restored"; imported: number; skipped: number };
type HistoryMergeOutcome = { status: "merged"; imported: number; skipped: number } | ImportError;

export function importResult(json: string): ResultImportOutcome {
  if (json.length > MAX_RESULT_FILE_BYTES) return { status: "too-large" };
  const snapshot = parseResultExport(json);
  const best = snapshot && bestMeasuredCandidate(snapshot.candidates);
  if (!snapshot || !best) return { status: "invalid" };
  const result = mergeHistory([historyRecordFromSnapshot(snapshot, best)]);
  if (result.status !== "merged") return result;
  return { status: result.imported ? "imported" : "duplicate", id: snapshot.id };
}

export function importHistoryFile(json: string, byteLength = json.length): HistoryImportOutcome {
  if (byteLength > MAX_HISTORY_FILE_BYTES || json.length > MAX_HISTORY_FILE_BYTES) return { status: "too-large" };
  const value = parse(json.replace(/^\uFEFF/, ""));

  if (!value || typeof value !== "object" || !("format" in value) || value.format !== HISTORY_BACKUP_FORMAT) {
    if (byteLength > MAX_RESULT_FILE_BYTES) return { status: "too-large" };
    return importResult(json);
  }

  if (!("version" in value) || value.version !== 1 || !("records" in value)) return { status: "invalid" };
  const { records } = value;
  if (!Array.isArray(records) || records.length > HISTORY_LIMIT || !records.every(isBackupRecord)) {
    return { status: "invalid" };
  }
  const result = mergeHistory(records);
  return result.status === "merged"
    ? { status: "restored", imported: result.imported, skipped: result.skipped }
    : result;
}

function mergeHistory(incoming: HistoryRecord[]): HistoryMergeOutcome {
  if (typeof window === "undefined") return { status: "unavailable" };
  try {
    const history = parseHistory(window.localStorage.getItem(KEYS.history));
    const seen = new Set(history.map((record) => record.id));
    const additions = incoming.filter((record) => {
      if (seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });
    const skipped = incoming.length - additions.length;
    if (!additions.length) return { status: "merged", imported: 0, skipped };

    const progress = readTestProgress();
    if (progress === undefined) return { status: "unavailable" };
    if (additions.some((record) => record.id === progress?.id)) return { status: "active-test" };
    if (history.length + additions.length > HISTORY_LIMIT) return { status: "full" };

    // 一次写入全部新增记录，配额不足时保留现有历史。
    const merged = [...additions, ...history].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const saved = safeSet(KEYS.history, JSON.stringify(merged));
    if (saved === "ok") return { status: "merged", imported: additions.length, skipped };
    return { status: saved === "quota" ? "full" : "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/* ---------- Last session（测试完成时写入，结果页兜底读取） ---------- */

export function saveLastSession(snapshot: SessionSnapshot): boolean {
  if (typeof window === "undefined" || !isSessionSnapshot(snapshot)) return false;
  // 即使容量不足，也保留刚完成的结果用于展示和导出。
  const saved = safeSet(KEYS.lastSession, JSON.stringify(snapshot)) === "ok";
  pendingSession = saved ? null : snapshot;
  return saved;
}

export function loadLastSession(): SessionSnapshot | null {
  if (typeof window === "undefined") return null;
  return pendingSession ?? readSavedLastSession();
}

function readSavedLastSession(): SessionSnapshot | null {
  const value = parse(safeGet(KEYS.lastSession));
  return isSessionSnapshot(value) ? value : null;
}

export function clearLastSession(): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.removeItem(KEYS.lastSession);
    pendingSession = null;
    return true;
  } catch {
    return false;
  }
}

/** 指定 ID 时绝不替换成其他会话；未指定 ID 才显示最近结果。 */
export function getSessionForResults(id: string | null): SessionSnapshot | null {
  if (!id) return loadLastSession();
  const history = getHistoryRecord(id);
  if (history) return history.snapshot;
  const last = loadLastSession();
  return last?.id === id ? last : null;
}

/* ---------- 未完成测试 ---------- */

function readTestProgress(): TestProgress | null | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return parseTestProgress(parse(window.localStorage.getItem(KEYS.testProgress)));
  } catch {
    return undefined;
  }
}

function sameTestProgress(current: TestProgress | null, expected: TestProgress): boolean {
  return current?.id === expected.id && JSON.stringify(current) === JSON.stringify(parseTestProgress(expected));
}

export function loadTestProgress(): TestProgress | null {
  const progress = readTestProgress();
  return progress && !getHistoryRecord(progress.id) ? progress : null;
}

export function saveTestProgress(
  progress: TestProgress,
  previous: TestProgress | null,
): "saved" | "unavailable" | "conflict" {
  const valid = parseTestProgress(progress);
  if (!valid) return "unavailable";
  const current = readTestProgress();
  if (current === undefined) return "unavailable";
  if (previous ? !sameTestProgress(current, previous) : current && !getHistoryRecord(current.id)) {
    return "conflict";
  }
  return safeSet(KEYS.testProgress, JSON.stringify(valid)) === "ok" ? "saved" : "unavailable";
}

export function clearTestProgress(expected: TestProgress): boolean {
  const current = readTestProgress();
  if (current === null) return true;
  if (current === undefined || !sameTestProgress(current, expected)) return false;
  try {
    window.localStorage.removeItem(KEYS.testProgress);
    return true;
  } catch {
    return false;
  }
}

/** localStorage 功能是否可用 */
export function isStorageAvailable(): boolean {
  const t = "__vsf_test__";
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}

/** 生成短 id */
export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
