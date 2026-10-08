import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { HistoryRecord, SessionSnapshot } from "../types";
import {
  parsePlayerSettings,
  validateSettingsInput,
  isSessionSnapshot,
  isHistoryRecord,
} from "../lib/validation";

describe("parsePlayerSettings", () => {
  it("accepts a valid settings object", () => {
    const result = parsePlayerSettings({ dpi: 1600, baseSensitivity: 0.42 });
    expect(result).not.toBeNull();
    expect(result?.dpi).toBe(1600);
    expect(result?.baseSensitivity).toBe(0.42);
  });

  it("falls back to defaults for missing or invalid optional fields", () => {
    const result = parsePlayerSettings({ dpi: 800, baseSensitivity: 0.35 });
    expect(result).not.toBeNull();
    expect(result?.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(result?.screenWidth).toBe(DEFAULT_SETTINGS.screenWidth);
    expect(result?.crosshairColor).toBe(DEFAULT_SETTINGS.crosshairColor);

    const badEnums = parsePlayerSettings({
      dpi: 800,
      baseSensitivity: 0.35,
      mode: "fast",
      crosshairColor: "red",
    });
    expect(badEnums?.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(badEnums?.crosshairColor).toBe(DEFAULT_SETTINGS.crosshairColor);
  });

  it("no longer carries the removed preference fields", () => {
    // 已移除的字段不应出现在解析结果中；旧存档中的多余键被忽略
    const result = parsePlayerSettings({
      dpi: 800,
      baseSensitivity: 0.35,
      skillLevel: "pro",
      playstyle: "sniper",
      hand: "both",
    });
    expect(result).not.toBeNull();
    expect("skillLevel" in (result as object)).toBe(false);
    expect("playstyle" in (result as object)).toBe(false);
    expect("hand" in (result as object)).toBe(false);
  });

  it("rejects out-of-range or non-integer dpi", () => {
    expect(parsePlayerSettings({ dpi: 0, baseSensitivity: 0.35 })).toBeNull();
    expect(parsePlayerSettings({ dpi: 49, baseSensitivity: 0.35 })).toBeNull();
    expect(parsePlayerSettings({ dpi: 20001, baseSensitivity: 0.35 })).toBeNull();
    expect(parsePlayerSettings({ dpi: 800.5, baseSensitivity: 0.35 })).toBeNull();
    expect(parsePlayerSettings({ dpi: NaN, baseSensitivity: 0.35 })).toBeNull();
  });

  it("rejects out-of-range sensitivity", () => {
    expect(parsePlayerSettings({ dpi: 800, baseSensitivity: 0.04 })).toBeNull();
    expect(parsePlayerSettings({ dpi: 800, baseSensitivity: 5.01 })).toBeNull();
    expect(parsePlayerSettings({ dpi: 800, baseSensitivity: NaN })).toBeNull();
    expect(parsePlayerSettings({ dpi: 800, baseSensitivity: "0.35" })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(parsePlayerSettings(null)).toBeNull();
    expect(parsePlayerSettings([800, 0.35])).toBeNull();
    expect(parsePlayerSettings("800")).toBeNull();
    expect(parsePlayerSettings(undefined)).toBeNull();
  });
});

describe("validateSettingsInput", () => {
  it("passes valid input", () => {
    expect(validateSettingsInput({ dpi: 800, baseSensitivity: 0.35 })).toEqual([]);
    expect(validateSettingsInput({ dpi: 50, baseSensitivity: 5 })).toEqual([]);
  });

  it("reports missing or invalid dpi", () => {
    expect(validateSettingsInput({ dpi: 0, baseSensitivity: 0.35 })[0]).toContain("DPI");
    expect(validateSettingsInput({ dpi: NaN, baseSensitivity: 0.35 })[0]).toContain("DPI");
    expect(validateSettingsInput({ dpi: 49, baseSensitivity: 0.35 })[0]).toContain("50");
    expect(validateSettingsInput({ dpi: 20001, baseSensitivity: 0.35 })[0]).toContain("20000");
    expect(validateSettingsInput({ dpi: 800.5, baseSensitivity: 0.35 })[0]).toContain("整数");
  });

  it("reports missing or invalid sensitivity", () => {
    expect(validateSettingsInput({ dpi: 800, baseSensitivity: 0 })[0]).toContain("灵敏度");
    expect(validateSettingsInput({ dpi: 800, baseSensitivity: NaN })[0]).toContain("灵敏度");
    expect(validateSettingsInput({ dpi: 800, baseSensitivity: 0.04 })[0]).toContain("0.05");
    expect(validateSettingsInput({ dpi: 800, baseSensitivity: 5.01 })[0]).toContain("5");
  });

  it("collects multiple errors together", () => {
    const errs = validateSettingsInput({ dpi: 0, baseSensitivity: 0 });
    expect(errs).toHaveLength(2);
  });
});

const validSnapshot: SessionSnapshot = {
  id: "snap-1",
  createdAt: 1700000000000,
  settings: { dpi: 800, baseSensitivity: 0.35, mode: "standard" },
  rounds: 2,
  candidates: [
    {
      sensitivity: 0.28,
      multiplier: 0.8,
      round: 1,
      orderInRound: 0,
      testsCompleted: 3,
      flickScore: 80,
      trackingScore: 82,
      microScore: 78,
      consistencyScore: 97,
      overallScore: 81,
      confidence: 0.5,
      finished: true,
      metrics: {
        overshootRate: 0.1,
        undershootRate: 0.1,
        missRate: 0,
        avgCorrections: 1,
        avgTimeToTarget: 500,
        flickAccuracy: 0.9,
      },
    },
  ],
  recommendation: {
    sensitivity: 0.32,
    rangeMin: 0.28,
    rangeMax: 0.36,
    dpi: 800,
    eDpi: 256,
    confidence: 80,
    confidenceLabel: "Medium-High",
    basisCount: 2,
    basis: [0.28, 0.35],
    reason: "test",
  },
  profile: { flick: 80, tracking: 82, micro: 78, stability: 90, speed: 70, precision: 75 },
  analysis: [{ severity: "info", title: "t", text: "x" }],
  calibration: { avgMoveSpeed: 800, avgClickDelay: 300, hitRate: 0.9, clicks: 8 },
};

const validHistory: HistoryRecord = {
  id: "snap-1",
  date: new Date(1700000000000).toISOString(),
  dpi: 800,
  baseSensitivity: 0.35,
  recommendedSensitivity: 0.32,
  rangeMin: 0.28,
  rangeMax: 0.36,
  eDpi: 256,
  flick: 80,
  tracking: 82,
  micro: 78,
  overall: 81,
  confidence: 80,
  confidenceLabel: "Medium-High",
  rounds: 2,
  snapshot: validSnapshot,
};

describe("isSessionSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(isSessionSnapshot(validSnapshot)).toBe(true);
    expect(isSessionSnapshot({ ...validSnapshot, calibration: null })).toBe(true);
  });

  it("rejects broken recommendation ranges", () => {
    const bad = {
      ...validSnapshot,
      recommendation: { ...validSnapshot.recommendation, rangeMin: 0.4 },
    };
    expect(isSessionSnapshot(bad)).toBe(false);
    const bad2 = {
      ...validSnapshot,
      recommendation: { ...validSnapshot.recommendation, rangeMax: 0.3 },
    };
    expect(isSessionSnapshot(bad2)).toBe(false);
  });

  it("rejects out-of-range rounds, scores and severities", () => {
    expect(isSessionSnapshot({ ...validSnapshot, rounds: 5 })).toBe(false);
    expect(isSessionSnapshot({ ...validSnapshot, profile: { ...validSnapshot.profile, flick: 101 } })).toBe(false);
    const badCandidate = {
      ...validSnapshot,
      candidates: [{ ...validSnapshot.candidates[0], overallScore: 101 }],
    };
    expect(isSessionSnapshot(badCandidate)).toBe(false);
    const badAnalysis = {
      ...validSnapshot,
      analysis: [{ severity: "bad", title: "t", text: "x" }],
    };
    expect(isSessionSnapshot(badAnalysis)).toBe(false);
  });

  it("rejects negative calibration metrics and bad hitRate", () => {
    const neg = {
      ...validSnapshot,
      calibration: { ...validSnapshot.calibration, clicks: -1 },
    };
    expect(isSessionSnapshot(neg)).toBe(false);
    const badRate = {
      ...validSnapshot,
      calibration: { ...validSnapshot.calibration, hitRate: 1.5 },
    };
    expect(isSessionSnapshot(badRate)).toBe(false);
  });

  it("rejects missing identity fields and non-objects", () => {
    expect(isSessionSnapshot({ ...validSnapshot, id: "" })).toBe(false);
    expect(isSessionSnapshot(null)).toBe(false);
    expect(isSessionSnapshot("x")).toBe(false);
  });
});

describe("isHistoryRecord", () => {
  it("accepts a well-formed record whose snapshot id matches", () => {
    expect(isHistoryRecord(validHistory)).toBe(true);
  });

  it("rejects when the snapshot id differs from the record id", () => {
    expect(isHistoryRecord({ ...validHistory, id: "other" })).toBe(false);
  });

  it("rejects invalid dates, labels and sensitivities", () => {
    expect(isHistoryRecord({ ...validHistory, date: "not-a-date" })).toBe(false);
    expect(isHistoryRecord({ ...validHistory, confidenceLabel: "Ultra" })).toBe(false);
    expect(isHistoryRecord({ ...validHistory, recommendedSensitivity: 0.02 })).toBe(false);
    expect(isHistoryRecord({ ...validHistory, rounds: 9 })).toBe(false);
  });
});
