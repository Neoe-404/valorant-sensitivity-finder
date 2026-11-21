import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  saveSettings,
  loadSettings,
  addHistoryRecord,
  saveHistory,
  loadHistory as getHistory,
  deleteHistoryRecord,
  clearHistory,
  saveLastSession,
  loadLastSession,
  makeId,
  getSessionForResults,
  clearLastSession,
  isStorageAvailable,
  importResult,
  historyBackup,
  importHistoryFile,
  saveTestProgress,
  loadTestProgress,
  clearTestProgress,
} from "../lib/storage";
import type { CandidateScore, HistoryRecord, SessionSnapshot, PlayerSettings, AimProfile, TestProgress } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const EMPTY_PROFILE: AimProfile = { flick: 0, tracking: 0, micro: 0, stability: 0, speed: 0, precision: 0 };

function fakeSettings(overrides: Partial<PlayerSettings> = {}): PlayerSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function fakeSnapshot(id: string, sens: number): SessionSnapshot {
  return {
    id,
    createdAt: 1700000000000,
    settings: { dpi: 800, baseSensitivity: 0.35, mode: "standard" },
    rounds: 2,
    candidates: [],
    recommendation: {
      sensitivity: sens,
      rangeMin: sens - 0.05,
      rangeMax: sens + 0.05,
      dpi: 800,
      eDpi: Math.round(sens * 800),
      confidence: 80,
      confidenceLabel: "High",
      basisCount: 2,
      basis: [sens],
      reason: "test",
    },
    profile: EMPTY_PROFILE,
    analysis: [],
    calibration: null,
  };
}

function fakeRecord(id: string, sens = 0.35): HistoryRecord {
  return {
    id,
    date: new Date(1700000000000).toISOString(),
    dpi: 800,
    baseSensitivity: sens,
    recommendedSensitivity: sens,
    rangeMin: sens - 0.05,
    rangeMax: sens + 0.05,
    eDpi: Math.round(sens * 800),
    flick: 80,
    tracking: 70,
    micro: 90,
    overall: 78,
    confidence: 80,
    confidenceLabel: "High",
    rounds: 2,
    snapshot: fakeSnapshot(id, sens),
  };
}

/** 在 node 环境安装 window.localStorage 桩 */
function installLocalStorage(store: Map<string, string>) {
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

function uninstallWindow() {
  delete (globalThis as { window?: unknown }).window;
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  installLocalStorage(store);
});
afterEach(() => {
  installLocalStorage(store);
  clearLastSession();
  uninstallWindow();
});

describe("storage: settings", () => {
  it("rejects invalid required fields and safely defaults optional settings", () => {
    store.set("vsf:settings:v1", "{}");
    expect(loadSettings()).toBeNull();
    store.set("vsf:settings:v1", JSON.stringify({ dpi: 800, baseSensitivity: 8 }));
    expect(loadSettings()).toBeNull();
    store.set("vsf:settings:v1", JSON.stringify({ dpi: 800, baseSensitivity: 0.35, mode: "broken" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(fakeSettings({ baseSensitivity: 0.01 }))).toBe(false);
  });

  it("handles a localStorage getter that throws before any method is called", () => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("SecurityError"); } });
    expect(loadSettings()).toBeNull();
    expect(saveSettings(fakeSettings())).toBe(false);
    expect(isStorageAvailable()).toBe(false);
  });
  it("round-trips settings", () => {
    saveSettings(fakeSettings({ dpi: 1600, baseSensitivity: 0.25, mode: "quick" }));
    const loaded = loadSettings();
    expect(loaded).not.toBeNull();
    expect(loaded?.dpi).toBe(1600);
    expect(loaded?.baseSensitivity).toBe(0.25);
    expect(loaded?.mode).toBe("quick");
  });

  it("returns null on empty storage", () => {
    expect(loadSettings()).toBeNull();
  });

  it("tolerates corrupted JSON", () => {
    store.set("vsf:settings:v1", "{oops");
    expect(loadSettings()).toBeNull();
  });
});

describe("storage: history", () => {
  it("filters structurally corrupt records while retaining valid records", () => {
    store.set("vsf:history:v1", JSON.stringify([null, {}, fakeRecord("valid"), { ...fakeRecord("bad"), snapshot: {} }]));
    expect(getHistory().map((record) => record.id)).toEqual(["valid"]);
  });

  it("caps stored history at the latest 50 records", () => {
    for (let i = 0; i < 60; i++) addHistoryRecord(fakeRecord(String(i)));
    expect(getHistory()).toHaveLength(50);
    expect(getHistory()[0].id).toBe("59");
    expect(getHistory()[49].id).toBe("10");
  });

  it("clears matching last-session snapshots on deletion", () => {
    const record = fakeRecord("deleted");
    addHistoryRecord(record);
    saveLastSession(record.snapshot);
    deleteHistoryRecord(record.id);
    expect(getSessionForResults(record.id)).toBeNull();
    expect(loadLastSession()).toBeNull();
  });

  it("removes a result held in memory without deleting a different saved snapshot", () => {
    const saved = fakeSnapshot("disk", 0.42);
    const record = fakeRecord("pending");
    addHistoryRecord(record);
    saveLastSession(saved);
    const write = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(saveLastSession(record.snapshot)).toBe(false);
    window.localStorage.setItem = write;

    expect(deleteHistoryRecord(record.id)).toEqual([]);
    expect(getSessionForResults(record.id)).toBeNull();
    expect(getSessionForResults(saved.id)).toEqual(saved);
  });

  it("removes a saved result without deleting a different result held in memory", () => {
    const record = fakeRecord("disk");
    const pending = fakeSnapshot("pending", 0.42);
    addHistoryRecord(record);
    saveLastSession(record.snapshot);
    const write = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(saveLastSession(pending)).toBe(false);
    window.localStorage.setItem = write;

    expect(deleteHistoryRecord(record.id)).toEqual([]);
    expect(store.has("vsf:lastSession:v1")).toBe(false);
    expect(getSessionForResults(pending.id)).toEqual(pending);
  });

  it.each([
    ["deletion", () => deleteHistoryRecord("keep")],
    ["clearing", clearHistory],
  ] as const)("keeps the fallback result when %s cannot write history", (_name, remove) => {
    const record = fakeRecord("keep");
    addHistoryRecord(record);
    saveLastSession(record.snapshot);
    window.localStorage.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };

    expect(remove()).toBeNull();
    expect(getHistory()).toEqual([record]);
    expect(loadLastSession()).toEqual(record.snapshot);
  });

  it("restores history when the matching saved snapshot cannot be removed", () => {
    const record = fakeRecord("keep");
    addHistoryRecord(record);
    saveLastSession(record.snapshot);
    window.localStorage.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); };

    expect(deleteHistoryRecord(record.id)).toBeNull();
    expect(getHistory()).toEqual([record]);
    expect(loadLastSession()).toEqual(record.snapshot);
  });

  it("preserves the result in memory but reports failure when storage is full", () => {
    window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    const record = fakeRecord("unsaved");
    expect(saveSettings(fakeSettings())).toBe(false);
    expect(saveLastSession(record.snapshot)).toBe(false);
    expect(addHistoryRecord(record)).toBeNull();
    expect(getHistory()).toEqual([]);
    expect(getSessionForResults(record.id)).toEqual(record.snapshot);
    expect(getSessionForResults("another-id")).toBeNull();
  });
  it("appends records newest-first and keeps all", () => {
    addHistoryRecord(fakeRecord("a"));
    addHistoryRecord(fakeRecord("b"));
    const hist = getHistory();
    expect(hist.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("returns the actual saved history when the quota requires trimming older records", () => {
    const oldest = fakeRecord("oldest");
    const previous = fakeRecord("previous");
    const newest = fakeRecord("newest");
    addHistoryRecord(oldest);
    addHistoryRecord(previous);
    const write = window.localStorage.setItem;
    window.localStorage.setItem = (key, value) => {
      if (key === "vsf:history:v1" && JSON.parse(value).length > 2) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      write(key, value);
    };

    expect(addHistoryRecord(newest)).toEqual([newest, previous]);
    expect(getHistory()).toEqual([newest, previous]);
  });

  it("does not replace existing history when reading it fails", () => {
    const key = "vsf:history:v1";
    addHistoryRecord(fakeRecord("keep"));
    const original = store.get(key);
    const read = window.localStorage.getItem;
    window.localStorage.getItem = (name) => {
      if (name === key) throw new DOMException("Blocked", "SecurityError");
      return read(name);
    };

    expect(addHistoryRecord(fakeRecord("new"))).toBeNull();
    expect(store.get(key)).toBe(original);
  });

  it("deduplicates by id", () => {
    addHistoryRecord(fakeRecord("a"));
    addHistoryRecord(fakeRecord("a"));
    expect(getHistory()).toHaveLength(1);
  });

  it("deletes a single record", () => {
    addHistoryRecord(fakeRecord("x"));
    expect(getHistory()).toHaveLength(1);
    deleteHistoryRecord("x");
    expect(getHistory()).toHaveLength(0);
  });

  it("clears history", () => {
    addHistoryRecord(fakeRecord("a"));
    addHistoryRecord(fakeRecord("b"));
    clearHistory();
    expect(getHistory()).toHaveLength(0);
  });

  it("tolerates corrupted history JSON", () => {
    store.set("vsf:history:v1", "not json[[");
    expect(getHistory()).toEqual([]);
  });

  it("returns [] when storage unavailable (SSR)", () => {
    uninstallWindow();
    expect(getHistory()).toEqual([]);
    expect(saveSettings(fakeSettings())).toBe(false);
  });
});

describe("storage: importing results", () => {
  function exportFixture(id: string, sensitivity = 0.35) {
    const snapshot = fakeSnapshot(id, sensitivity);
    const best: CandidateScore = {
      sensitivity, multiplier: sensitivity / snapshot.settings.baseSensitivity,
      round: 1, orderInRound: 0, testsCompleted: 3,
      flickScore: 80, trackingScore: 70, microScore: 90, overallScore: 78, consistencyScore: 80,
      confidence: 0.55, finished: true, metrics: null,
    };
    snapshot.candidates = [best];
    snapshot.recommendation.basisCount = 1;
    return JSON.stringify(snapshot);
  }

  it("does not overwrite a different saved record with the same test id", () => {
    const existing = fakeRecord("same-test", 0.35);
    addHistoryRecord(existing);
    expect(importResult(exportFixture(existing.id, 0.42))).toEqual({ status: "duplicate", id: existing.id });
    expect(getHistory()).toEqual([existing]);
  });

  it("does not evict existing records when history is full", () => {
    for (let i = 0; i < 50; i++) addHistoryRecord(fakeRecord(String(i)));
    const original = store.get("vsf:history:v1");
    expect(importResult(exportFixture("extra"))).toEqual({ status: "full" });
    expect(store.get("vsf:history:v1")).toBe(original);
  });

  it("preserves history if the browser runs out of quota", () => {
    addHistoryRecord(fakeRecord("stored"));
    const original = store.get("vsf:history:v1");
    window.localStorage.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
    expect(importResult(exportFixture("future"))).toEqual({ status: "full" });
    expect(store.get("vsf:history:v1")).toBe(original);
  });

  it("keeps an active test available when an import has the same id", () => {
    const draft: TestProgress = {
      version: 4,
      id: "running",
      settings: fakeSettings(),
      calibration: { avgMoveSpeed: 0, avgClickDelay: 0, clicks: 0, hitRate: 0 },
      tests: [],
    };
    expect(saveTestProgress(draft, null)).toBe("saved");
    expect(importResult(exportFixture(draft.id))).toEqual({ status: "active-test" });
    expect(loadTestProgress()).toEqual(draft);
    expect(getHistory()).toEqual([]);
  });
});

describe("storage: restoring a history backup", () => {
  it("merges the full file in chronological order and skips duplicate IDs without overwriting", () => {
    const local = { ...fakeRecord("local", 0.35), date: "2024-02-01T00:00:00.000Z" };
    const backup = [
      { ...fakeRecord("first"), date: "2024-01-01T00:00:00.000Z" },
      { ...fakeRecord("last"), date: "2024-03-01T00:00:00.000Z" },
      fakeRecord("local", 0.42),
      fakeRecord("first", 0.42),
    ];
    addHistoryRecord(local);
    saveLastSession(local.snapshot);
    const json = "\uFEFF" + JSON.stringify(historyBackup(backup));
    expect(importHistoryFile(json)).toEqual({ status: "restored", imported: 2, skipped: 2 });
    expect(getHistory()).toEqual([backup[1], local, backup[0]]);
    expect(loadLastSession()).toEqual(local.snapshot);
    expect(importHistoryFile(json)).toEqual({ status: "restored", imported: 0, skipped: 4 });
  });

  it("rejects the whole backup if an entry is malformed or the format is unsupported", () => {
    addHistoryRecord(fakeRecord("local"));
    const original = store.get("vsf:history:v1");
    const valid = historyBackup([fakeRecord("other")]);
    const busted = { ...fakeRecord("broken"), snapshot: null };
    expect(importHistoryFile(JSON.stringify({ ...valid, records: [...valid.records, busted] }))).toEqual({ status: "invalid" });
    expect(importHistoryFile(JSON.stringify({ ...valid, version: 2 }))).toEqual({ status: "invalid" });
    expect(store.get("vsf:history:v1")).toBe(original);
  });

  it("rejects the whole batch before writing if it would exceed the history limit", () => {
    for (let i = 0; i < 49; i++) addHistoryRecord(fakeRecord(String(i)));
    const original = store.get("vsf:history:v1");
    const backup = historyBackup([fakeRecord("one"), fakeRecord("two")]);
    expect(importHistoryFile(JSON.stringify(backup))).toEqual({ status: "full" });
    expect(store.get("vsf:history:v1")).toBe(original);
  });

  it("leaves history unchanged on a storage error", () => {
    addHistoryRecord(fakeRecord("local"));
    const original = store.get("vsf:history:v1");
    window.localStorage.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
    const backup = historyBackup([fakeRecord("one"), fakeRecord("two")]);
    expect(importHistoryFile(JSON.stringify(backup))).toEqual({ status: "full" });
    expect(store.get("vsf:history:v1")).toBe(original);
  });

  it("does not hide an active draft or import another record from its backup", () => {
    const draft: TestProgress = {
      version: 6, id: "live", settings: fakeSettings(),
      calibration: { avgMoveSpeed: 0, avgClickDelay: 0, clicks: 0, hitRate: 0 },
      tests: [],
    };
    expect(saveTestProgress(draft, null)).toBe("saved");
    expect(importHistoryFile(JSON.stringify(historyBackup([fakeRecord("other"), fakeRecord(draft.id)])))).toEqual({ status: "active-test" });
    expect(getHistory()).toEqual([]);
    expect(loadTestProgress()).toEqual(draft);
  });
});

describe("storage: last session & id", () => {
  it("opens both the pending and persisted result by ID after a failed write", () => {
    const saved = fakeSnapshot("saved", 0.41);
    const pending = { ...fakeSnapshot("pending", 0.35), createdAt: saved.createdAt + 10 };
    saveLastSession(saved);
    window.localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(saveLastSession(pending)).toBe(false);

    expect(getSessionForResults(saved.id)).toEqual(saved);
    expect(getSessionForResults(pending.id)).toEqual(pending);
    expect(getSessionForResults(null)).toEqual(pending);

    const newer = { ...fakeSnapshot("newer", 0.5), createdAt: pending.createdAt + 10 };
    store.set("vsf:lastSession:v1", JSON.stringify(newer));
    expect(getSessionForResults(null)).toEqual(newer);
    expect(getSessionForResults(pending.id)).toEqual(pending);
  });

  it("preserves a unique fallback and still returns a newer history result without an ID", () => {
    const legacy = fakeSnapshot("legacy", 0.41);
    const newer = { ...fakeSnapshot("in-history", 0.35), createdAt: legacy.createdAt + 10 };
    saveLastSession(legacy);
    const record = { ...fakeRecord(newer.id), snapshot: newer };
    expect(addHistoryRecord(record)).not.toBeNull();

    expect(getSessionForResults(legacy.id)).toEqual(legacy);
    expect(getSessionForResults(null)).toEqual(newer);
  });

  it("only falls back to the latest result when IDs match or no ID was requested", () => {
    const snap = fakeSnapshot("latest", 0.42);
    saveLastSession(snap);
    expect(getSessionForResults("missing")).toBeNull();
    expect(getSessionForResults("latest")).toEqual(snap);
    expect(getSessionForResults(null)).toEqual(snap);
    clearHistory();
    expect(getSessionForResults(null)).toBeNull();
  });

  it("rejects valid JSON with invalid snapshot structure or a reversed range", () => {
    store.set("vsf:lastSession:v1", "{}");
    expect(loadLastSession()).toBeNull();
    const snap = fakeSnapshot("invalid", 0.42);
    snap.recommendation.rangeMax = 0.1;
    store.set("vsf:lastSession:v1", JSON.stringify(snap));
    expect(loadLastSession()).toBeNull();
  });
  it("round-trips last session", () => {
    const snap = fakeSnapshot("s1", 0.42);
    saveLastSession(snap);
    expect(loadLastSession()?.id).toBe("s1");
    expect(loadLastSession()?.recommendation.sensitivity).toBeCloseTo(0.42, 5);
  });

  it("returns null when absent or corrupted", () => {
    expect(loadLastSession()).toBeNull();
    store.set("vsf:lastSession:v1", "[[[x");
    expect(loadLastSession()).toBeNull();
  });

  it("generates unique ids", () => {
    expect(makeId()).not.toBe(makeId());
  });
});

describe("storage: unfinished test progress", () => {
  const initial: TestProgress = {
    version: 1,
    id: "session-in-progress",
    settings: fakeSettings(),
    calibration: { avgMoveSpeed: 500, avgClickDelay: 260, hitRate: 0.8, clicks: 8 },
    tests: [],
  };

  it("keeps the newer progress when an older tab tries to save or remove a different run", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    const advanced: TestProgress = {
      ...initial,
      tests: [{ sensitivity: 0.28, testIndex: 1, measurement: { score: 75 } }],
    };
    expect(saveTestProgress(advanced, initial)).toBe("saved");
    expect(saveTestProgress({ ...initial, id: "other-session" }, null)).toBe("conflict");
    expect(saveTestProgress(initial, initial)).toBe("conflict");
    expect(clearTestProgress({ ...initial, id: "other-session" })).toBe(false);
    expect(clearTestProgress(initial)).toBe(false);
    expect(loadTestProgress()).toEqual(advanced);
    expect(clearTestProgress(advanced)).toBe(true);
    expect(loadTestProgress()).toBeNull();
  });

  it("distinguishes a temporarily unreadable draft from a deliberate removal", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    const read = window.localStorage.getItem;
    window.localStorage.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    expect(saveTestProgress(initial, initial)).toBe("unavailable");
    expect(clearTestProgress(initial)).toBe(false);
    window.localStorage.getItem = read;
    expect(clearTestProgress(initial)).toBe(true);
    expect(saveTestProgress(initial, initial)).toBe("conflict");
  });

  it("does not offer a stale draft once its result exists on disk", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(fakeRecord(initial.id));
    expect(loadTestProgress()).toBeNull();
    const next = { ...initial, id: "new-test" };
    expect(saveTestProgress(next, null)).toBe("saved");
    expect(loadTestProgress()).toEqual(next);
  });

  it.each([
    ["deleting the result", () => deleteHistoryRecord(initial.id)],
    ["clearing history", clearHistory],
    ["replacing history", () => saveHistory([]) ? [] : null],
  ] as const)("does not restore a previously saved test after %s", (_name, remove) => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(fakeRecord(initial.id));
    expect(loadTestProgress()).toBeNull();

    expect(remove()).toEqual([]);
    expect(loadTestProgress()).toBeNull();
    expect(saveTestProgress({ ...initial, id: "next-test" }, null)).toBe("saved");
  });

  it("retains the saved result if its stale draft cannot be removed", () => {
    const record = fakeRecord(initial.id);
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(record);
    const remove = window.localStorage.removeItem;
    window.localStorage.removeItem = (key) => {
      if (key === "vsf:testProgress:v1") throw new DOMException("Blocked", "SecurityError");
      remove(key);
    };

    expect(deleteHistoryRecord(initial.id)).toBeNull();
    expect(getHistory()).toEqual([record]);
    expect(loadTestProgress()).toBeNull();

    window.localStorage.removeItem = remove;
    expect(deleteHistoryRecord(initial.id)).toEqual([]);
    expect(loadTestProgress()).toBeNull();
  });

  it("preserves a different unfinished test when clearing history", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(fakeRecord("different-test"));
    expect(clearHistory()).toEqual([]);
    expect(loadTestProgress()).toEqual(initial);
  });

  it("rejects a checkpoint update from a tab that still has an already saved test open", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(fakeRecord(initial.id));
    const outdated: TestProgress = {
      ...initial,
      tests: [{ sensitivity: 0.28, testIndex: 1, measurement: { score: 75 } }],
    };

    expect(saveTestProgress(outdated, initial)).toBe("conflict");
    expect(deleteHistoryRecord(initial.id)).toEqual([]);
    expect(saveTestProgress(outdated, initial)).toBe("conflict");
    expect(loadTestProgress()).toBeNull();
  });

  it("cleans up the stale draft when its result ages out of a full history", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(fakeRecord(initial.id));
    for (let index = 0; index < 50; index++) addHistoryRecord(fakeRecord(`history-${index}`));

    expect(getHistory()).toHaveLength(50);
    expect(getHistory().some((record) => record.id === initial.id)).toBe(false);
    expect(loadTestProgress()).toBeNull();
  });

  it("cleans up the stale draft when the browser quota requires dropping its result", () => {
    expect(saveTestProgress(initial, null)).toBe("saved");
    addHistoryRecord(fakeRecord(initial.id));
    const write = window.localStorage.setItem;
    window.localStorage.setItem = (key, value) => {
      if (key === "vsf:history:v1" && JSON.parse(value).length > 1) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      write(key, value);
    };

    const next = fakeRecord("new-result");
    expect(addHistoryRecord(next)).toEqual([next]);
    expect(loadTestProgress()).toBeNull();
  });

  it("skips corrupt or unsupported progress and can save a new test", () => {
    const key = "vsf:testProgress:v1";
    store.set(key, JSON.stringify({
      ...initial,
      tests: [{ sensitivity: 0.28, testIndex: 2, measurement: { score: 120, avgCorrections: 0 } }],
    }));
    expect(loadTestProgress()).toBeNull();
    store.set(key, JSON.stringify({ ...initial, version: 11 }));
    expect(loadTestProgress()).toBeNull();
    expect(saveTestProgress(initial, null)).toBe("saved");
  });
});
