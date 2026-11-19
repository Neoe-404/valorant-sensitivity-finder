import { describe, it, expect } from "vitest";
import { analyzeResult, buildAimProfile, buildAnalysis } from "../lib/analysis-engine";
import type { CandidateScore, CandidateMetrics, SessionSnapshot } from "../types";

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

function analysisFor(best: CandidateScore, recommendation = best.sensitivity) {
  return buildAnalysis({ baseSensitivity: 0.35, best, rounds: 2, calibration: null }, recommendation);
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
    const items = analysisFor(best);
    const warn = items.find((i) => i.title.includes("过冲"));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("high undershoot triggers a warning", () => {
    const best = makeCandidate({}, { overshootRate: 0.1, undershootRate: 0.7 });
    const items = analysisFor(best);
    const warn = items.find((i) => i.title.includes("欠冲"));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("uses the recommendation when it differs in direction from the highest-scoring candidate", () => {
    const low = makeCandidate({ sensitivity: 0.28 });
    const [increase] = analysisFor(low, 0.37);
    expect(increase.title).toContain("提高");
    expect(increase.text).toContain("0.370");

    const high = makeCandidate({ sensitivity: 0.42 });
    const [decrease] = analysisFor(high, 0.33);
    expect(decrease.title).toContain("降低");
    expect(decrease.text).toContain("0.330");
  });

  it("tracking weak + micro strong → tracking advice", () => {
    const best = makeCandidate({ trackingScore: 50, microScore: 88 });
    const items = analysisFor(best);
    expect(items.some((i) => i.title.includes("跟踪稳定性"))).toBe(true);
  });

  it("does not praise target acquisition when none of the flick attempts hit", () => {
    const best = makeCandidate({ flickScore: 0 }, { flickAccuracy: 0, missRate: 1, overshootRate: 0, undershootRate: 0 });
    expect(analysisFor(best).some((item) => item.title === "一次性到位能力不错")).toBe(false);
  });

  it("updates a historic interpretation using its saved recommendation and actual measured scores", () => {
    const unfinished = makeCandidate({ sensitivity: 0.36, overallScore: 99, finished: false });
    const best = makeCandidate({ sensitivity: 0.37, overallScore: 89 });
    const other = makeCandidate({ sensitivity: 0.31, overallScore: 86 });
    const snapshot: SessionSnapshot = {
      id: "history-1",
      createdAt: 0,
      settings: { dpi: 800, baseSensitivity: 0.35, mode: "quick" },
      rounds: 2,
      candidates: [unfinished, best, other],
      recommendation: {
        sensitivity: 0.341, rangeMin: 0.31, rangeMax: 0.37, dpi: 800, eDpi: 273,
        confidence: 45, confidenceLabel: "Low", basisCount: 2, basis: [0.37, 0.31], reason: "",
      },
      profile: buildAimProfile({ best, baseSensitivity: 0.35, rounds: 2, calibration: null }),
      calibration: null,
      analysis: [{ severity: "info", title: "建议略微提高灵敏度", text: "旧建议" }],
    };
    const display = analyzeResult(snapshot);
    expect(display.best).toBe(best);
    expect(display.analysis[0].title).toBe("推荐值接近当前灵敏度");
    expect(display.analysis[0].text).toContain("0.341");
    expect(snapshot.analysis[0].text).toBe("旧建议");
  });
});
