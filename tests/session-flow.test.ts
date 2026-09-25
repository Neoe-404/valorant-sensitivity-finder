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
}));

import { useSensitivitySession } from "../hooks/useSensitivitySession";
import { DEFAULT_SETTINGS } from "../types";
import { clearLastSession, getSessionForResults, loadHistory } from "../lib/storage";
import { computeFlickScore, computeMicroScore, computeTrackingScore } from "../lib/scoring";

const settings = { ...DEFAULT_SETTINGS, mode: "quick" as const };
let store: Map<string, string>;
function SessionHarness() {
  host.index = 0;
  return useSensitivitySession(settings);
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
      t, cursorX: t, cursorY: 0, targetX: t, targetY: 0, error: 0, inside: true, cursorSpeed: 100, targetSpeed: 100,
    })) : [] }),
    computeMicroScore({ targetRadius: 8, durationMs: 1000, records: valid ? [{
      targetId: 1, targetX: 100, targetY: 100, targetRadius: 8, spawnTime: 0, hitTime: 700,
      holdStartTime: 300, avgHoldError: 1, maxHoldError: 2, corrections: 0, holdMs: 400, completionTime: 700,
    }] : [] }),
  ];
}
function finishSession(valid: boolean) {
  let flow = SessionHarness();
  flow.finishCalibration({ durationMs: 2000, clicks: 6, avgMoveSpeed: 600, avgClickDelay: 300, avgReachDistance: 100, hitRate: 1, timestamp: 1 });
  flow = SessionHarness();
  const results = samples(valid);
  let guard = 0;
  while (flow.state.stage === "testing" && guard++ < 40) {
    flow.recordTestResult(results[flow.state.testIndex]);
    flow = SessionHarness();
  }
  expect(guard).toBeLessThan(40);
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
