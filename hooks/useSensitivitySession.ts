"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TestRun, type SceneResult, type TestPositionProgress } from "@/lib/test-run";
import { buildAimProfile, buildAnalysis } from "@/lib/analysis-engine";
import { historyRecordFromSnapshot } from "@/lib/result-record";
import {
  addHistoryRecord, clearTestProgress, getHistoryRecord, makeId, saveLastSession,
  saveTestProgress, testProgressStatus, watchTestProgress,
} from "@/lib/storage";
import type { CalibrationResult, HistoryRecord, PlayerSettings, SessionSnapshot } from "@/types";

type SessionFlowState =
  | ({ stage: "testing" } & TestPositionProgress)
  | { stage: "calibration" | "finalizing" | "error" | "conflict" };

function stateFor(run: TestRun): SessionFlowState {
  const position = run.position;
  return position ? { stage: "testing", ...position } : { stage: "finalizing" };
}

export function useSensitivitySession(settings: PlayerSettings, initialRun: TestRun | null = null) {
  const runRef = useRef(initialRun);
  const storedProgressRef = useRef(initialRun?.progress ?? null);
  const settledRef = useRef(false);
  const [state, setState] = useState<SessionFlowState>(initialRun ? stateFor(initialRun) : { stage: "calibration" });
  const [final, setFinal] = useState<{ snapshot: SessionSnapshot; history: HistoryRecord } | null>(null);
  const [storageSaved, setStorageSaved] = useState<boolean | null>(null);
  const [progressSaved, setProgressSaved] = useState<boolean | null>(initialRun ? true : null);
  const [error, setError] = useState<string | null>(null);

  const showSavedResult = useCallback((record: HistoryRecord) => {
    setStorageSaved(true);
    setFinal({ snapshot: record.snapshot, history: record });
    setState({ stage: "finalizing" });
  }, []);

  const stopOutdatedRun = useCallback(() => {
    settledRef.current = true;
    const id = runRef.current?.progress.id;
    const completed = id ? getHistoryRecord(id) : null;
    if (completed) showSavedResult(completed);
    else setState({ stage: "conflict" });
  }, [showSavedResult]);

  const checkCurrentProgress = useCallback(() => {
    if (settledRef.current) return false;
    if (testProgressStatus(storedProgressRef.current) !== "conflict") return true;
    stopOutdatedRun();
    return false;
  }, [stopOutdatedRun]);

  useEffect(() => {
    const unsubscribe = watchTestProgress(checkCurrentProgress);
    checkCurrentProgress();
    return unsubscribe;
  }, [checkCurrentProgress]);

  const persistProgress = useCallback((run: TestRun) => {
    const progress = run.progress;
    const outcome = saveTestProgress(progress, storedProgressRef.current);
    if (outcome === "conflict") {
      stopOutdatedRun();
      return false;
    }
    if (outcome === "saved") storedProgressRef.current = progress;
    setProgressSaved(outcome === "saved");
    return true;
  }, [stopOutdatedRun]);

  const finalize = useCallback((run: TestRun) => {
    if (settledRef.current) return;
    settledRef.current = true;

    const { search, progress: { id, settings, calibration: summary } } = run;
    const calibration = summary.clicks > 0 ? summary : null;
    const stored = storedProgressRef.current;
    const existing = getHistoryRecord(id);
    if (existing) {
      if (stored) clearTestProgress(stored);
      showSavedResult(existing);
      return;
    }

    const best = search.bestCandidate();
    let recommendation;
    try {
      if (!best) throw new Error("有效测试成绩不足，无法生成推荐。请重新完成测试。");
      recommendation = search.recommend();
    } catch (cause) {
      if (stored) clearTestProgress(stored);
      setError(cause instanceof Error ? cause.message : "无法生成推荐，请重新测试。");
      setState({ stage: "error" });
      return;
    }

    const rounds = search.currentRound;
    const input = { baseSensitivity: settings.baseSensitivity, best, rounds, calibration };
    const snapshot: SessionSnapshot = {
      id,
      createdAt: Date.now(),
      settings: { dpi: settings.dpi, baseSensitivity: settings.baseSensitivity, mode: settings.mode },
      rounds,
      candidates: search.candidates,
      recommendation,
      profile: buildAimProfile(input),
      analysis: buildAnalysis(input, recommendation.sensitivity),
      calibration,
    };
    const record = historyRecordFromSnapshot(snapshot, best);

    const historySaved = addHistoryRecord(record) !== null;
    if (!historySaved) saveLastSession(snapshot);
    // 保留完整进度，直到结果真正进入历史。
    if (historySaved && stored) clearTestProgress(stored);
    setStorageSaved(historySaved);
    setFinal({ snapshot, history: record });
  }, [showSavedResult]);

  // 如果最后一项已完成但结果未能落盘，可以直接重试保存。
  useEffect(() => {
    if (initialRun && !initialRun.position && !settledRef.current && persistProgress(initialRun)) finalize(initialRun);
  }, [initialRun, finalize, persistProgress]);

  const finishCalibration = useCallback((cal: CalibrationResult | null) => {
    if (runRef.current || settledRef.current) return;
    // 保留已有草稿格式，用零点击表示没有校准样本。
    const { avgMoveSpeed, avgClickDelay, hitRate, clicks } = cal ??
      { avgMoveSpeed: 0, avgClickDelay: 0, hitRate: 0, clicks: 0 };
    const run = new TestRun(makeId(), settings, { avgMoveSpeed, avgClickDelay, hitRate, clicks });
    runRef.current = run;
    if (persistProgress(run)) setState(stateFor(run));
  }, [persistProgress, settings]);

  const recordTestResult = useCallback((result: SceneResult) => {
    const run = runRef.current;
    if (settledRef.current || !run || !run.recordResult(result) || !persistProgress(run)) return;
    setState(stateFor(run));
    if (!run.position) finalize(run);
  }, [persistProgress, finalize]);

  return {
    state,
    recordTestResult,
    finishCalibration,
    checkCurrentProgress,
    finalSnapshot: final?.snapshot ?? null,
    finalHistory: final?.history ?? null,
    storageSaved,
    progressSaved,
    error,
  };
}
