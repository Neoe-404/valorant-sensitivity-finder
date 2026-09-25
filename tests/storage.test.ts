import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  saveSettings,
  loadSettings,
  addHistoryRecord,
  loadHistory as getHistory,
  deleteHistoryRecord,
  clearHistory,
  saveLastSession,
  loadLastSession,
  makeId,
  getSessionForResults,
  clearLastSession,
  isStorageAvailable,
} from "../lib/storage";
import type { HistoryRecord, SessionSnapshot, PlayerSettings, AimProfile } from "../types";
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

describe("storage: last session & id", () => {
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
