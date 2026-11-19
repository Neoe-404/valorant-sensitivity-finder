import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlickResult, MicroResult, TrackingResult } from "../types";

// A stateful hook host lets each event render the next state without browser globals.
const host = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = host.index++;
    if (!(index in host.slots)) host.slots[index] = { current: initial };
    return host.slots[index];
  },
  useState: (initial: unknown) => {
    const index = host.index++;
    if (!(index in host.slots)) host.slots[index] = initial;
    return [host.slots[index], (next: unknown) => {
      host.slots[index] = typeof next === "function" ? next(host.slots[index]) : next;
    }];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void) => { effect(); },
}));

import { useSensitivitySession } from "../hooks/useSensitivitySession";
import { DEFAULT_SETTINGS } from "../types";
import { clearHistory, clearLastSession, getSessionForResults, importResult, loadHistory, loadTestProgress } from "../lib/storage";
import { computeFlickScore, computeMicroScore, computeTrackingScore } from "../lib/scoring";
import { TestRun } from "../lib/test-run";

const settings = { ...DEFAULT_SETTINGS, mode: "quick" as const };
const calibration = { durationMs: 2000, clicks: 6, avgMoveSpeed: 600, avgClickDelay: 300, avgReachDistance: 100, hitRate: 1, timestamp: 1 };
let store: Map<string, string>;
function SessionHarness(run: TestRun | null = null, preferences = settings) {
  host.index = 0;
  return useSensitivitySession(preferences, run);
}
function samples(valid: boolean): [FlickResult, TrackingResult, MicroResult] {
  return [
    computeFlickScore({ targetRadius: 36, durationMs: 1000, records: valid ? [{
      targetId: 1, targetX: 300, targetY: 100, targetRadius: 36, startX: 0, startY: 100,
      spawnTime: 0, firstMoveTime: 160, hitTime: 380, hitX: 300, hitY: 100, hit: true,
      pathSampleCount: 20, totalMouseDistance: 300, idealDistance: 300, correctionCount: 0,
      overshoot: false, overshootDistance: 0, undershoot: false, reactionTime: 160, timeToTarget: 380,
    }] : [] }),
    computeTrackingScore({ targetRadius: 26, seed: 1, samples: valid ? [0, 16].map((t) => ({
      t, cursorX: t, cursorY: 0, targetX: t, targetY: 0,
    })) : [] }),
    computeMicroScore({ targetRadius: 8, durationMs: 1000, records: valid ? [{
      targetId: 1, targetX: 100, targetY: 100, targetRadius: 8, spawnTime: 0, hitTime: 700,
      holdStartTime: 300, avgHoldError: 1, maxHoldError: 2, corrections: 0, holdMs: 400, completionTime: 700,
    }] : [] }),
  ];
}
function finishSession(valid: boolean, repeatCallbacks = false) {
  SessionHarness().finishCalibration(calibration);
  return completeRemaining(valid, repeatCallbacks);
}

function completeRemaining(valid: boolean, repeatCallbacks = false, run: TestRun | null = null) {
  let flow = SessionHarness(run);
  const results = samples(valid);
  const measured = new Set(run?.search.candidates.map((card) => card.sensitivity));
  if (run?.position && run.position.testIndex > 0) measured.add(run.position.currentSensitivity);
  let guard = 0;
  while (flow.state.stage === "testing" && guard++ < 40) {
    if (flow.state.testIndex === 0) {
      expect(measured.has(flow.state.currentSensitivity)).toBe(false);
      measured.add(flow.state.currentSensitivity);
    }
    const result = results[flow.state.testIndex];
    flow.recordTestResult(result);
    if (repeatCallbacks) flow.recordTestResult(result);
    flow = SessionHarness(run);
  }
  expect(guard).toBeLessThan(40);
  if (valid) expect(flow.finalSnapshot?.candidates.map((card) => card.sensitivity)).toEqual([...measured]);
  return flow;
}

beforeEach(() => {
  host.slots = [];
  host.index = 0;
  store = new Map();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } });
});
afterEach(() => {
  clearLastSession();
  vi.unstubAllGlobals();
});

describe("session flow and result handoff", () => {
  it("finishes all candidate tests and saves a validated result readable by ID", () => {
    const flow = finishSession(true);
    expect(flow.state.stage).toBe("finalizing");
    expect(flow.error).toBeNull();
    expect(flow.finalSnapshot).not.toBeNull();
    expect(loadHistory()).toHaveLength(1);
    expect(getSessionForResults(flow.finalHistory!.id)).toEqual(flow.finalSnapshot);
    expect(loadTestProgress()).toBeNull();
  });

  it("restores an actual exported test after clearing browser history", () => {
    const { finalSnapshot, finalHistory } = finishSession(true);
    const json = JSON.stringify(finalSnapshot);
    expect(clearHistory()).toEqual([]);
    expect(importResult(json)).toEqual({ status: "imported", id: finalSnapshot!.id });
    expect(loadHistory()).toEqual([finalHistory]);
    expect(getSessionForResults(finalSnapshot!.id)).toEqual(finalSnapshot);
    expect(importResult(json)).toEqual({ status: "duplicate", id: finalSnapshot!.id });
    expect(loadHistory()).toHaveLength(1);
  });

  it("resumes in the next round at the first unfinished scene using the original settings", () => {
    SessionHarness().finishCalibration(calibration);
    const results = samples(true);
    for (let i = 0; i < 11; i++) {
      const flow = SessionHarness();
      if (flow.state.stage !== "testing") throw new Error("Expected an active candidate");
      flow.recordTestResult(results[flow.state.testIndex]);
    }
    const beforeReload = SessionHarness().state;
    expect(beforeReload).toMatchObject({
      stage: "testing", round: 2, currentSensitivity: 0.308, testIndex: 2,
      completedTests: 11, remainingInRound: 4,
    });
    const progress = loadTestProgress()!;
    expect(progress.version).toBe(4);
    expect(progress.tests).toHaveLength(11);
    expect(progress.tests[0].measurement).not.toHaveProperty("records");

    host.slots = [];
    const restored = TestRun.restore(progress)!;
    expect(SessionHarness(restored, { ...settings, dpi: 1600 }).state).toEqual(beforeReload);
    const completed = completeRemaining(true, false, restored);
    expect(completed.finalSnapshot?.settings.dpi).toBe(800);
    expect(completed.finalSnapshot?.candidates.map((card) => card.sensitivity)).toEqual([0.28, 0.35, 0.42, 0.308, 0.392]);
    expect(loadHistory()[0].id).toBe(progress.id);
    expect(loadTestProgress()).toBeNull();
  });

  it("counts only unfinished tests in the current round near the sensitivity bound", () => {
    const lowerBound = { ...settings, baseSensitivity: 0.05 };
    SessionHarness(null, lowerBound).finishCalibration(calibration);
    const before = SessionHarness(null, lowerBound);
    expect(before.state).toMatchObject({ stage: "testing", completedTests: 0, remainingInRound: 6 });
    before.recordTestResult(samples(true)[0]);
    expect(SessionHarness(null, lowerBound).state).toMatchObject({
      stage: "testing", testIndex: 1, completedTests: 1, remainingInRound: 5,
    });
  });

  it("rejects stored measurements that do not belong to the scheduled candidate", () => {
    SessionHarness().finishCalibration(calibration);
    SessionHarness().recordTestResult(samples(true)[0]);
    const progress = loadTestProgress()!;
    expect(TestRun.restore({ ...progress, tests: [{ ...progress.tests[0], sensitivity: 0.42 }] })).toBeNull();
  });

  it.each([1, 2, 3] as const)("retains the rules of version %s after restoring an older run", (version) => {
    SessionHarness().finishCalibration(calibration);
    SessionHarness().recordTestResult(samples(true)[0]);
    const progress = loadTestProgress()!;
    const restored = TestRun.restore({ ...progress, version });
    expect(restored?.progress.version).toBe(version);
    expect(restored?.position?.testIndex).toBe(1);
    expect(Boolean(restored?.position?.plan)).toBe(version === 3);
  });

  it("reuses the session's plan through rendering, retries and a reload", () => {
    SessionHarness().finishCalibration(calibration);
    const initial = SessionHarness().state;
    if (initial.stage !== "testing") throw new Error("Expected a planned test");
    const originalPlan = initial.plan;
    expect(originalPlan).toBeDefined();
    const results = samples(true);
    SessionHarness().recordTestResult(results[0]);
    const run = TestRun.restore(loadTestProgress()!)!;
    expect(run.position?.plan).toEqual(originalPlan);
    run.recordResult(results[1]);
    run.recordResult(results[2]);
    expect(run.position?.plan?.seed).toBe(originalPlan?.seed);
    expect(run.position?.plan?.variant).not.toBe(originalPlan?.variant);
  });

  it("keeps the last saved progress during a write failure and catches up on the next scene", () => {
    SessionHarness().finishCalibration(calibration);
    const persisted = loadTestProgress();
    const write = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
    const results = samples(true);
    SessionHarness().recordTestResult(results[0]);
    expect(SessionHarness().state).toMatchObject({ stage: "testing", testIndex: 1 });
    expect(SessionHarness().progressSaved).toBe(false);
    expect(loadTestProgress()).toEqual(persisted);

    window.localStorage.setItem = write;
    SessionHarness().recordTestResult(results[1]);
    expect(SessionHarness().progressSaved).toBe(true);
    expect(loadTestProgress()?.tests.map((scene) => scene.testIndex)).toEqual([0, 1]);
  });

  it("retries saving a completed test from disk without running any scenes again", () => {
    const write = window.localStorage.setItem;
    window.localStorage.setItem = (key, value) => {
      if (!key.startsWith("vsf:testProgress:")) throw new DOMException("Storage full", "QuotaExceededError");
      write(key, value);
    };
    const completed = finishSession(true);
    expect(completed.storageSaved).toBe(false);
    expect(loadHistory()).toEqual([]);
    const progress = loadTestProgress()!;
    const restored = TestRun.restore(progress)!;
    expect(restored.position).toBeNull();

    clearLastSession();
    host.slots = [];
    window.localStorage.setItem = write;
    SessionHarness(restored);
    expect(SessionHarness(restored).finalHistory?.id).toBe(progress.id);
    expect(loadHistory()).toHaveLength(1);
    expect(loadTestProgress()).toBeNull();
  });

  it("keeps a completed draft when the latest result saves but history fails", () => {
    const write = window.localStorage.setItem;
    window.localStorage.setItem = (key, value) => {
      if (key === "vsf:history:v1") throw new DOMException("History full", "QuotaExceededError");
      write(key, value);
    };
    const flow = finishSession(true);
    const id = flow.finalSnapshot!.id;
    expect(loadHistory()).toEqual([]);
    expect(getSessionForResults(id)).toEqual(flow.finalSnapshot);
    const progress = loadTestProgress();
    expect(progress?.id).toBe(id);

    host.slots = [];
    window.localStorage.setItem = write;
    const restored = TestRun.restore(progress!)!;
    expect(restored.position).toBeNull();
    SessionHarness(restored);
    expect(loadHistory().map(record => record.id)).toEqual([id]);
    expect(loadTestProgress()).toBeNull();
  });

  it("stops a stale tab at the final scene without overwriting the newer draft or result", () => {
    const results = samples(true);
    SessionHarness().finishCalibration(calibration);
    const original = loadTestProgress()!;
    const newer = TestRun.restore(original)!;
    newer.recordResult({ ...results[0], score: 75 });
    const write = window.localStorage.setItem;
    window.localStorage.setItem = (key, value) => {
      if (key === "vsf:testProgress:v1") throw new DOMException("Storage full", "QuotaExceededError");
      write(key, value);
    };
    for (let i = 0; i < 14; i++) {
      const flow = SessionHarness();
      if (flow.state.stage !== "testing") throw new Error("Expected an active candidate");
      flow.recordTestResult(results[flow.state.testIndex]);
    }
    expect(SessionHarness().state).toMatchObject({ stage: "testing", testIndex: 2 });
    window.localStorage.setItem = write;
    write("vsf:testProgress:v1", JSON.stringify(newer.progress));

    SessionHarness().recordTestResult(results[2]);
    expect(SessionHarness().state.stage).toBe("conflict");
    expect(loadTestProgress()).toEqual(newer.progress);
    expect(getSessionForResults(original.id)).toBeNull();
    expect(loadHistory()).toEqual([]);
  });

  it("ignores duplicate scene callbacks before React renders the next test", () => {
    const flow = finishSession(true, true);
    expect(flow.state.stage).toBe("finalizing");
    expect(flow.finalSnapshot?.candidates.length).toBeGreaterThanOrEqual(3);
    expect(loadHistory()).toHaveLength(1);
  });

  it("hands off the current result even when both persistence writes fail", () => {
    window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    const flow = finishSession(true);
    expect(flow.state.stage).toBe("finalizing");
    expect(loadHistory()).toEqual([]);
    expect(getSessionForResults(flow.finalHistory!.id)).toEqual(flow.finalSnapshot);
  });

  it("shows an actionable error instead of an endless spinner for all-zero scores", () => {
    const flow = finishSession(false);
    expect(flow.state.stage).toBe("error");
    expect(flow.error).toContain("有效测试成绩不足");
    expect(flow.finalSnapshot).toBeNull();
    expect(loadHistory()).toEqual([]);
  });
});
