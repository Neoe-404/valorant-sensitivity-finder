import { SensitivitySearch } from "./sensitivity-engine";
import { virtualSensitivityScale } from "./mouse-math";
import { scenePlanFor, type ScenePlan } from "./test-plan";
import type {
  CalibrationSummary,
  FlickMeasurement,
  FlickResult,
  MicroResult,
  PlayerSettings,
  RecordedTest,
  TestProgress,
  TrackingMeasurement,
  TrackingResult,
} from "@/types";

export interface TestPosition {
  round: number;
  roundCandidates: number[];
  candidateIndex: number;
  currentSensitivity: number;
  multiplier: number;
  testIndex: RecordedTest["testIndex"];
  plan?: ScenePlan;
}

export interface TestPositionProgress extends TestPosition {
  completedTests: number;
  remainingInRound: number;
}

export type SceneResult = FlickResult | TrackingResult | MicroResult;

/** 完成的项目按原顺序重放，恢复时仍由同一个搜索策略决定下一项。 */
export class TestRun {
  readonly search: SensitivitySearch;
  private current: TestPosition | null;
  private checkpoint: TestProgress;
  private flick: FlickMeasurement | null = null;
  private tracking: TrackingMeasurement | null = null;

  constructor(id: string, settings: PlayerSettings, calibration: CalibrationSummary, version: TestProgress["version"] = 6) {
    this.search = new SensitivitySearch(
      settings.baseSensitivity, settings.dpi, settings.mode, version >= 6 ? "contiguous" : "all-high",
    );
    this.checkpoint = { version, id, settings, calibration, tests: [] };
    this.current = this.positionAt(this.search.initialCandidates(), 0);
  }

  static restore(progress: TestProgress): TestRun | null {
    const run = new TestRun(progress.id, progress.settings, progress.calibration, progress.version);
    for (const test of progress.tests) {
      if (!run.record(test)) return null;
    }
    return run;
  }

  get position(): TestPositionProgress | null {
    const current = this.current;
    if (!current) return null;
    return {
      ...current,
      completedTests: this.checkpoint.tests.length,
      remainingInRound: (current.roundCandidates.length - current.candidateIndex) * 3 - current.testIndex,
    };
  }

  get progress(): TestProgress {
    return this.checkpoint;
  }

  recordResult(result: SceneResult): boolean {
    const sensitivity = this.current?.currentSensitivity;
    if (sensitivity === undefined) return false;

    // 只保存评分和分析使用的指标，避免把逐帧轨迹写入存储。
    if ("avgReactionTime" in result) {
      const { score, overshootRate, undershootRate, misses, attempts, avgCorrections, avgTimeToTarget, accuracy } = result;
      return this.record({
        sensitivity,
        testIndex: 0,
        measurement: { score, overshootRate, undershootRate, misses, attempts, avgCorrections, avgTimeToTarget, accuracy },
      });
    }
    if ("sampleCount" in result) {
      return this.record({ sensitivity, testIndex: 1, measurement: { score: result.score } });
    }
    return this.record({
      sensitivity,
      testIndex: 2,
      measurement: { score: result.score, avgCorrections: result.avgCorrections },
    });
  }

  private record(test: RecordedTest): boolean {
    const position = this.current;
    if (!position || test.testIndex !== position.testIndex || test.sensitivity !== position.currentSensitivity) {
      return false;
    }

    switch (test.testIndex) {
      case 0:
        this.flick = test.measurement;
        this.current = { ...position, testIndex: 1 };
        break;
      case 1:
        this.tracking = test.measurement;
        this.current = { ...position, testIndex: 2 };
        break;
      case 2: {
        if (!this.flick || !this.tracking) return false;
        this.search.completeCandidate(test.sensitivity, {
          flick: this.flick,
          tracking: this.tracking,
          micro: test.measurement,
        });
        this.flick = null;
        this.tracking = null;
        const nextIndex = position.candidateIndex + 1;
        if (nextIndex < position.roundCandidates.length) {
          this.current = this.positionAt(position.roundCandidates, nextIndex);
        } else {
          const nextRound = this.search.nextRound();
          this.current = nextRound ? this.positionAt(nextRound, 0) : null;
        }
        break;
      }
    }

    this.checkpoint = { ...this.checkpoint, tests: [...this.checkpoint.tests, test] };
    return true;
  }

  private positionAt(candidates: number[], index: number): TestPosition {
    const sensitivity = candidates[index];
    const { dpi, screenWidth } = this.checkpoint.settings;
    return {
      round: this.search.currentRound,
      roundCandidates: candidates,
      candidateIndex: index,
      currentSensitivity: sensitivity,
      multiplier: virtualSensitivityScale(sensitivity, dpi, screenWidth),
      testIndex: 0,
      plan: this.checkpoint.version >= 3 ? scenePlanFor(this.checkpoint.id, this.search.candidates.length) : undefined,
    };
  }
}
