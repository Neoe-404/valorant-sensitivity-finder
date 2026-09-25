/**
 * localStorage 封装（SSR 安全）。
 * 所有持久化都走这里，避免在业务代码里直接操作 localStorage。
 * 第一版用于本地；键名前缀预留未来迁移 Supabase 时使用同一数据模型。
 */

import type { HistoryRecord, PlayerSettings, SessionSnapshot } from "@/types";
import { isHistoryRecord, isSessionSnapshot, parsePlayerSettings } from "./validation";

const KEYS = {
  settings: "vsf:settings:v1",
  history: "vsf:history:v1",
  lastSession: "vsf:lastSession:v1",
} as const;

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

function safeSet(key: string, value: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
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
  return valid !== null && safeSet(KEYS.settings, JSON.stringify(valid));
}

export function loadSettings(): PlayerSettings | null {
  return parsePlayerSettings(parse(safeGet(KEYS.settings)));
}

/* ---------- History ---------- */

export function loadHistory(): HistoryRecord[] {
  const list = parse(safeGet(KEYS.history));
  return Array.isArray(list) ? list.filter(isHistoryRecord) : [];
}

export function saveHistory(records: HistoryRecord[]): boolean {
  return records.every(isHistoryRecord) && safeSet(KEYS.history, JSON.stringify(records));
}

export function addHistoryRecord(record: HistoryRecord): HistoryRecord[] | null {
  const list = loadHistory();
  // 去重（同 id 覆盖）
  const filtered = list.filter((r) => r.id !== record.id);
  const next = [record, ...filtered].slice(0, 50);
  return saveHistory(next) ? next : null;
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

/* ---------- Last session（测试完成时写入，结果页兜底读取） ---------- */

export function saveLastSession(snapshot: SessionSnapshot): boolean {
  if (typeof window === "undefined" || !isSessionSnapshot(snapshot)) return false;
  // 即使容量不足，也保留刚完成的结果用于展示和导出。
  const saved = safeSet(KEYS.lastSession, JSON.stringify(snapshot));
  pendingSession = saved ? null : snapshot;
  return saved;
}

export function loadLastSession(): SessionSnapshot | null {
  if (typeof window === "undefined") return null;
  if (pendingSession) return pendingSession;
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
