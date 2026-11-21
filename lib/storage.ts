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
  if (typeof window === "undefined" || !records.every(isHistoryRecord)) return false;
  try {
    const existing = parseHistory(window.localStorage.getItem(KEYS.history));
    return clearDraftForRemovedHistory(existing, records) && safeSet(KEYS.history, JSON.stringify(records)) === "ok";
  } catch {
    return false;
  }
}

function clearDraftForRemovedHistory(existing: HistoryRecord[], next: HistoryRecord[]): boolean {
  const keptIds = new Set(next.map((record) => record.id));
  const removed = existing.filter((record) => !keptIds.has(record.id));
  if (!removed.length) return true;

  const progress = readTestProgress();
  if (progress === undefined) return false;
  // 历史中的结果已取代同 ID 的草稿。先清草稿，避免移除结果后重新提供续测。
  return !progress || !removed.some((record) => record.id === progress.id) || clearTestProgress(progress);
}

/**
 * 写入历史记录。空间不足时丢弃最旧的记录后重试，
 * 直到写成功或仅剩新记录为止（保证本次结果尽量留存，牺牲旧历史）。
 */
function writeHistory(records: HistoryRecord[], existing: HistoryRecord[]): HistoryRecord[] | null {
  if (!records.every(isHistoryRecord)) return null;
  // 旧版本会另存一次最近结果；已在历史中的副本不应占用配额。
  removeDuplicateLastSession(existing);
  let trimmed = records;
  for (;;) {
    if (!clearDraftForRemovedHistory(existing, trimmed)) return null;
    const outcome = safeSet(KEYS.history, JSON.stringify(trimmed));
    if (outcome === "ok") return trimmed;
    if (outcome !== "quota" || trimmed.length <= 1) return null;
    trimmed = trimmed.slice(0, trimmed.length - 1);
  }
}

function removeDuplicateLastSession(history: HistoryRecord[]): void {
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(KEYS.lastSession);
    const snapshot = parse(raw);
    if (
      isSessionSnapshot(snapshot) &&
      history.some((record) => record.id === snapshot.id) &&
      storage.getItem(KEYS.lastSession) === raw
    ) {
      storage.removeItem(KEYS.lastSession);
    }
  } catch {
    // 清理副本失败仍尝试保存历史。
  }
}

export function addHistoryRecord(record: HistoryRecord): HistoryRecord[] | null {
  if (!isHistoryRecord(record) || typeof window === "undefined") return null;
  try {
    // 读取失败时保留原有历史，以免把读不到的记录当成空列表。
    const existing = parseHistory(window.localStorage.getItem(KEYS.history));
    const next = [record, ...existing.filter((r) => r.id !== record.id)].slice(0, HISTORY_LIMIT);
    return writeHistory(next, existing);
  } catch {
    return null;
  }
}

export function deleteHistoryRecord(id: string): HistoryRecord[] | null {
  return removeHistoryRecords(id);
}

export function clearHistory(): HistoryRecord[] | null {
  return removeHistoryRecords(null);
}

function removeHistoryRecords(id: string | null): HistoryRecord[] | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const previousHistory = storage.getItem(KEYS.history);
    const history = parseHistory(previousHistory);
    const previousLastSession = storage.getItem(KEYS.lastSession);
    const saved = parse(previousLastSession);
    const removeSaved = previousLastSession !== null &&
      (id === null || (isSessionSnapshot(saved) && saved.id === id));
    const next = id === null ? [] : history.filter((record) => record.id !== id);
    if (!clearDraftForRemovedHistory(history, next)) return null;
    const nextHistory = JSON.stringify(next);
    storage.setItem(KEYS.history, nextHistory);

    try {
      // 另一个标签页可能已保存了新的最近结果。
      if (removeSaved && storage.getItem(KEYS.lastSession) === previousLastSession) {
        storage.removeItem(KEYS.lastSession);
      }
    } catch {
      // 只回退这次写入，保留其他标签页之后写入的历史。
      if (storage.getItem(KEYS.history) === nextHistory) {
        if (previousHistory === null) storage.removeItem(KEYS.history);
        else storage.setItem(KEYS.history, previousHistory);
      }
      return null;
    }

    if (id === null || pendingSession?.id === id) pendingSession = null;
    return next;
  } catch {
    return null;
  }
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
  let latest = readSavedLastSession();
  for (const { snapshot } of loadHistory()) {
    if (!latest || snapshot.createdAt > latest.createdAt) latest = snapshot;
  }
  return pendingSession && (!latest || pendingSession.createdAt >= latest.createdAt) ? pendingSession : latest;
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
  if (typeof window === "undefined") return null;
  if (!id) return loadLastSession();
  const history = getHistoryRecord(id);
  if (history) return history.snapshot;
  if (pendingSession?.id === id) return pendingSession;
  const saved = readSavedLastSession();
  return saved?.id === id ? saved : null;
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

export function testProgressStatus(expected: TestProgress | null): "current" | "unavailable" | "conflict" {
  const current = readTestProgress();
  if (current === undefined) return "unavailable";
  const conflict = expected
    ? !sameTestProgress(current, expected) || Boolean(getHistoryRecord(expected.id))
    : current && !getHistoryRecord(current.id);
  return conflict ? "conflict" : "current";
}

export function watchTestProgress(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  try {
    const storage = window.localStorage;
    const onStorage = ({ key, storageArea }: StorageEvent) => {
      // 首页和续测入口都会把已保存到历史的草稿视为完成。
      if (storageArea === storage && (key === null || key === KEYS.testProgress || key === KEYS.history)) onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  } catch {
    return () => {};
  }
}

export function saveTestProgress(
  progress: TestProgress,
  previous: TestProgress | null,
): "saved" | "unavailable" | "conflict" {
  const valid = parseTestProgress(progress);
  if (!valid) return "unavailable";
  const status = testProgressStatus(previous);
  if (status !== "current") return status;
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
