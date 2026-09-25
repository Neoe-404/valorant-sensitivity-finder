"use client";

import { useCallback, useRef, useState } from "react";
import { SensitivitySearch } from "@/lib/sensitivity-engine";
import { buildAimProfile, buildAnalysis } from "@/lib/analysis-engine";
import { addHistoryRecord, makeId, saveLastSession } from "@/lib/storage";
import { virtualSensitivityScale } from "@/lib/mouse-math";
import type {
  CalibrationResult,
  FlickResult,
  MicroResult,
  SessionSnapshot,
  TrackingResult,
  HistoryRecord,
} from "@/types";
import type { PlayerSettings } from "@/types";

export type FlowStage = "calibration" | "testing" | "finalizing" | "error";

export interface SessionFlowState {
  stage: FlowStage;
  round: number;
  /** 本轮候选列表 */
  roundCandidates: number[];
  candidateIndex: number;
  /** 当前候选灵敏度 */
  currentSensitivity: number;
  multiplier: number;
  /** 0=Flick 1=Tracking 2=Micro */
  testIndex: number;
  /** 已完成候选数 */
  candidatesDone: number;
  /** 已完成轮数 */
  roundsDone: number;
}

export interface SessionFlow {
  state: SessionFlowState;
  calibration: CalibrationResult | null;
  recordTestResult: (result: FlickResult | TrackingResult | MicroResult) => void;
  finishCalibration: (cal: CalibrationResult) => void;
  finalSnapshot: SessionSnapshot | null;
  finalHistory: HistoryRecord | null;
  error: string | null;
}

/**
 * 灵敏度测试会话管理：
 * 负责候选顺序推进、三项测试结果聚合、引擎更新与最终快照落库。
 * 引擎操作/落库都在事件回调中执行，不在 render 与 setState 更新器中执行副作用。
 */
export function useSensitivitySession(settings: PlayerSettings): SessionFlow {
  const engineRef = useRef<SensitivitySearch | null>(null);
  const pendingRef = useRef<{ flick: FlickResult | null; tracking: TrackingResult | null; micro: MicroResult | null }>({
    flick: null,
    tracking: null,
    micro: null,
  });
  const calRef = useRef<CalibrationResult | null>(null);

  /** 每 count 倍率；画布再按当前视口宽度调整。 */
  const scaleOf = useCallback(
    (sens: number) => virtualSensitivityScale(sens, settings.dpi, settings.screenWidth),
    [settings.dpi, settings.screenWidth]
  );

  const [state, setState] = useState<SessionFlowState>({
    stage: "calibration",
    round: 0,
    roundCandidates: [],
    candidateIndex: 0,
    currentSensitivity: settings.baseSensitivity,
    multiplier: 1,
    testIndex: 0,
    candidatesDone: 0,
    roundsDone: 0,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const [final, setFinal] = useState<{ snapshot: SessionSnapshot; history: HistoryRecord } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finishCalibration = useCallback(
    (cal: CalibrationResult) => {
      calRef.current = cal;
      const engine = new SensitivitySearch(settings.baseSensitivity, settings.dpi, settings.mode);
      engineRef.current = engine;
      const first = engine.initialCandidates();
      setState((prev) => ({
        ...prev,
        stage: "testing",
        round: 1,
        roundCandidates: first,
        candidateIndex: 0,
        currentSensitivity: first[0],
        multiplier: scaleOf(first[0]),
        testIndex: 0,
        candidatesDone: 0,
        roundsDone: 0,
      }));
    },
    [settings.baseSensitivity, settings.dpi, settings.mode, scaleOf]
  );

  const finalize = useCallback(
    (search: SensitivitySearch) => {
      const best = search.bestCandidate();
      if (!best) return;
      let recommendation;
      try {
        recommendation = search.recommend();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法生成推荐，请重新测试。");
        setState((prev) => ({ ...prev, stage: "error" }));
        return;
      }
      const calBrief = calRef.current
        ? {
            avgMoveSpeed: calRef.current.avgMoveSpeed,
            avgClickDelay: calRef.current.avgClickDelay,
            hitRate: calRef.current.hitRate,
            clicks: calRef.current.clicks,
          }
        : null;
      const profile = buildAimProfile({
        baseSensitivity: settings.baseSensitivity,
        best,
        rounds: search.currentRound,
        calibration: calBrief,
      });
      const analysis = buildAnalysis({
        baseSensitivity: settings.baseSensitivity,
        best,
        rounds: search.currentRound,
        calibration: calBrief,
      });

      const snapshot: SessionSnapshot = {
        id: makeId(),
        createdAt: Date.now(),
        settings: {
          dpi: settings.dpi,
          baseSensitivity: settings.baseSensitivity,
          mode: settings.mode,
        },
        rounds: search.currentRound,
        candidates: search.candidates,
        recommendation,
        profile,
        analysis,
        calibration: calBrief,
      };
      saveLastSession(snapshot);

      const record: HistoryRecord = {
        id: snapshot.id,
        date: new Date().toISOString(),
        dpi: settings.dpi,
        baseSensitivity: settings.baseSensitivity,
        recommendedSensitivity: recommendation.sensitivity,
        rangeMin: recommendation.rangeMin,
        rangeMax: recommendation.rangeMax,
        eDpi: recommendation.eDpi,
        flick: Math.round(best.flickScore ?? 0),
        tracking: Math.round(best.trackingScore ?? 0),
        micro: Math.round(best.microScore ?? 0),
        overall: Math.round(best.overallScore ?? 0),
        confidence: recommendation.confidence,
        confidenceLabel: recommendation.confidenceLabel,
        rounds: search.currentRound,
        snapshot,
      };
      addHistoryRecord(record);
      setFinal({ snapshot, history: record });
    },
    [settings.baseSensitivity, settings.dpi, settings.mode]
  );

  const recordTestResult = useCallback(
    (result: FlickResult | TrackingResult | MicroResult) => {
      const search = engineRef.current;
      if (!search) return;
      const pending = pendingRef.current;
      const s = stateRef.current; // render 时同步更新，事件回调内读取最新状态
      if (s.stage !== "testing") return;

      if (s.testIndex === 0 && "avgReactionTime" in result) pending.flick = result;
      else if (s.testIndex === 1 && "sampleCount" in result) pending.tracking = result;
      else if (s.testIndex === 2 && "avgHoldError" in result) pending.micro = result;
      else return;

      // 三项齐全 → 聚合为候选成绩（副作用放事件回调，避免 StrictMode 双调用 updater）
      if (pending.flick && pending.tracking && pending.micro) {
        search.completeCandidate(s.currentSensitivity, {
          flick: pending.flick,
          tracking: pending.tracking,
          micro: pending.micro,
        });
        pendingRef.current = { flick: null, tracking: null, micro: null };
      }

      if (s.stage !== "testing") return;
      // 候选内推进到下一个测试
      if (s.testIndex < 2) {
        setState((prev) => ({ ...prev, testIndex: ((prev.testIndex + 1) % 3) as 0 | 1 | 2 }));
        return;
      }
      // 当前候选三个测试都完成 → 下一个候选
      const nextIndex = s.candidateIndex + 1;
      if (nextIndex < s.roundCandidates.length) {
        const sens = s.roundCandidates[nextIndex];
        setState({
          ...s,
          candidateIndex: nextIndex,
          testIndex: 0,
          currentSensitivity: sens,
          multiplier: scaleOf(sens),
          candidatesDone: s.candidatesDone + 1,
        });
        return;
      }
      // 本轮全部完成 → 下一轮或结束（finalize 在事件回调内执行）
      const next = search.nextRound();
      if (!next) {
        setState({ ...s, stage: "finalizing" as FlowStage });
        finalize(search);
        return;
      }
      const sens = next[0];
      setState({
        ...s,
        round: search.currentRound,
        roundCandidates: next,
        candidateIndex: 0,
        testIndex: 0,
        currentSensitivity: sens,
        multiplier: scaleOf(sens),
        candidatesDone: s.candidatesDone + 1,
        roundsDone: search.currentRound - 1,
      });
    },
    [finalize, scaleOf]
  );

  return {
    state,
    calibration: calRef.current,
    recordTestResult,
    finishCalibration,
    finalSnapshot: final?.snapshot ?? null,
    finalHistory: final?.history ?? null,
    error,
  };
}
