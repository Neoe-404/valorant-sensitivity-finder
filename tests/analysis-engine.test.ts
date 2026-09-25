import { describe, it, expect } from "vitest";
import { buildAimProfile, buildAnalysis } from "../lib/analysis-engine";
import type { CandidateScore, CandidateMetrics } from "../types";

function makeCandidate(overrides: Partial<CandidateScore> = {}, metrics: Partial<CandidateMetrics> = {}): CandidateScore {
  return {
    sensitivity: 0.35,
    multiplier: 1,
    round: 1,
    orderInRound: 0,
    testsCompleted: 3,
    flickScore: 80,
    trackingScore: 70,
    microScore: 85,
    consistencyScore: 80,
    overallScore: 78,
    confidence: 0.7,
    finished: true,
    metrics: {
      overshootRate: 0.1,
      undershootRate: 0.1,
      missRate: 0,
      avgCorrections: 1,
      avgTimeToTarget: 420,
      flickAccuracy: 0.95,
      ...metrics,
    },
    ...overrides,
  };
}

describe("analysis engine", () => {
  it("profile numbers are derived from real scores", () => {
    const best = makeCandidate();
    const profile = buildAimProfile({
      baseSensitivity: 0.35,
      best,
      rounds: 3,
      calibration: { avgMoveSpeed: 900, avgClickDelay: 250 },
    });
    expect(profile.flick).toBe(80);
    expect(profile.tracking).toBe(70);
    expect(profile.micro).toBe(85);
    expect(profile.speed).toBeGreaterThan(0);
    expect(profile.speed).toBeLessThanOrEqual(100);
    expect(profile.precision).toBeGreaterThan(0);
  });

  it("high overshoot triggers a warning", () => {
    const best = makeCandidate({}, { overshootRate: 0.6, undershootRate: 0.1 });
    const items = buildAnalysis({ baseSensitivity: 0.35, best, rounds: 2, calibration: null });
    const warn = items.find((i) => i.title.includes("过冲"));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("high undershoot triggers a warning", () => {
    const best = makeCandidate({}, { overshootRate: 0.1, undershootRate: 0.7 });
    const items = buildAnalysis({ baseSensitivity: 0.35, best, rounds: 2, calibration: null });
    const warn = items.find((i) => i.title.includes("欠冲"));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("direction rule reacts to best vs base sensitivity", () => {
    const low = makeCandidate({ sensitivity: 0.28 });
    const items = buildAnalysis({ baseSensitivity: 0.35, best: low, rounds: 2, calibration: null });
    expect(items.some((i) => i.title.includes("降低"))).toBe(true);

    const high = makeCandidate({ sensitivity: 0.42 });
    const items2 = buildAnalysis({ baseSensitivity: 0.35, best: high, rounds: 2, calibration: null });
    expect(items2.some((i) => i.title.includes("提高"))).toBe(true);
  });

  it("tracking weak + micro strong → tracking advice", () => {
    const best = makeCandidate({ trackingScore: 50, microScore: 88 });
    const items = buildAnalysis({ baseSensitivity: 0.35, best, rounds: 3, calibration: null });
    expect(items.some((i) => i.title.includes("跟踪稳定性"))).toBe(true);
  });

  it("always returns at least one item", () => {
    const best = makeCandidate();
    const items = buildAnalysis({ baseSensitivity: 0.35, best, rounds: 4, calibration: null });
    expect(items.length).toBeGreaterThan(0);
  });
});
