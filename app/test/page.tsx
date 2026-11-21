"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AimArena, useAim } from "@/components/aim/AimArena";
import { FlickTest } from "@/components/tests/FlickTest";
import { TrackingTest } from "@/components/tests/TrackingTest";
import { MicroAdjustmentTest } from "@/components/tests/MicroAdjustmentTest";
import { CalibrationTest } from "@/components/tests/CalibrationTest";
import { configFor } from "@/components/tests/shared";
import { DebugPanel } from "@/components/DebugPanel";
import { ExportResultButton } from "@/components/results/ExportResultButton";
import { useSensitivitySession } from "@/hooks/useSensitivitySession";
import {
  clearTestProgress, getHistoryRecord, loadSettings, loadTestProgress,
  testProgressStatus, watchTestProgress,
} from "@/lib/storage";
import { TestRun, type TestPositionProgress } from "@/lib/test-run";
import { virtualSensitivityScale, cmPer360, eDpi } from "@/lib/mouse-math";
import { MIN_ARENA_HEIGHT, MIN_ARENA_WIDTH } from "@/lib/arena-geometry";
import { Check, Crosshair, Pause, Play, RotateCcw, X } from "lucide-react";
import type { PlayerSettings } from "@/types";

const TEST_NAMES = ["FLICK TEST", "TRACKING TEST", "MICRO TEST"] as const;
const TEST_LABELS = ["甩枪", "跟枪", "微调"] as const;
const RETRY_PROMPTS = {
  "tracking-idle": {
    title: "请重试跟枪",
    text: "本段准星移动过少，成绩未记录。重试时请移动鼠标跟随目标。",
    action: "重试本段跟枪",
  },
  "calibration-idle": {
    title: "校准未采集到点击",
    text: "重试时请移动准星并点击目标。也可以跳过校准，直接开始正式测试。",
    action: "重试校准",
  },
};

export default function TestPage() {
  const router = useRouter();
  const [entry, setEntry] = useState<{ settings: PlayerSettings | null; resume: TestRun | null } | null>(null);
  const [resumeSelected, setResumeSelected] = useState(false);
  const [discardError, setDiscardError] = useState(false);
  const [mobile, setMobile] = useState(false);

  const readEntry = useCallback(() => {
    const settings = loadSettings();
    const progress = loadTestProgress();
    const resume = progress ? TestRun.restore(progress) : null;
    if (progress && !resume) clearTestProgress(progress);
    if (!settings && !resume) {
      router.replace("/setup");
      return;
    }
    setEntry({ settings, resume });
    setDiscardError(false);
  }, [router]);

  useEffect(readEntry, [readEntry]);

  const offeredProgress = resumeSelected ? null : entry?.resume?.progress;
  useEffect(() => {
    if (!offeredProgress) return;
    const refresh = () => {
      if (testProgressStatus(offeredProgress) !== "conflict") return;
      const completed = getHistoryRecord(offeredProgress.id);
      if (completed) router.replace(`/results?id=${completed.id}`);
      else readEntry();
    };
    const unsubscribe = watchTestProgress(refresh);
    refresh();
    return unsubscribe;
  }, [offeredProgress, readEntry, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    const check = () => setMobile(mq.matches);
    check();
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, []);

  if (mobile) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <Crosshair size={40} className="mb-6 text-accent" />
        <h1 className="text-2xl font-bold">请使用桌面电脑和鼠标完成测试</h1>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          瞄准测试需要 Pointer Lock 与精确的鼠标增量数据，
          触屏设备无法提供。你可以先在手机上浏览首页、结果与历史。
        </p>
        <button className="btn-ghost mt-6" onClick={() => router.push("/")}>
          返回首页
        </button>
      </main>
    );
  }

  if (!entry) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20">
        <div className="h-24 animate-pulse rounded-xl border border-line bg-panel" />
      </main>
    );
  }

  const { resume } = entry;
  if (resume && !resumeSelected) {
    const { progress, position } = resume;
    const discard = () => {
      if (!window.confirm("重新开始会清除上次的测试进度。确定重新开始？")) return;
      if (!clearTestProgress(progress)) {
        setDiscardError(true);
        return;
      }
      if (entry.settings) setEntry({ settings: entry.settings, resume: null });
      else router.replace("/setup");
    };
    return (
      <main className="mx-auto flex min-h-[75vh] max-w-xl items-center px-4 py-12">
        <section className="panel w-full p-6 sm:p-8">
          <h1 className="text-2xl font-bold">发现上次测试进度</h1>
          <p className="mt-3 text-sm text-dim">
            {progress.settings.dpi} DPI · 灵敏度 {progress.settings.baseSensitivity.toFixed(3)} ·
            {progress.settings.mode === "quick" ? " 快速模式" : " 标准模式"}
          </p>
          {position ? (
            <div className="mt-4">
              <RoundProgress position={position} />
              <p className="mt-3 text-sm text-dim">候选灵敏度 {position.currentSensitivity.toFixed(3)}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-dim">测试已完成，可以重试保存结果。</p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => setResumeSelected(true)}>
              <Play size={16} /> {position ? "继续上次测试" : "重试保存结果"}
            </button>
            <button className="btn-ghost" onClick={discard}>重新开始</button>
            <button className="btn-ghost" onClick={() => router.push("/setup")}>返回设置</button>
          </div>
          {discardError ? (
            <p role="alert" className="mt-4 text-sm text-warn">无法清除进度。请刷新页面，查看最新保存状态后重试。</p>
          ) : null}
        </section>
      </main>
    );
  }

  const settings = resume?.progress.settings ?? entry.settings;
  return settings ? <ActiveSession settings={settings} initialRun={resume} /> : null;
}

function ActiveSession({ settings, initialRun }: { settings: PlayerSettings; initialRun: TestRun | null }) {
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);
  const flow = useSensitivitySession(settings, initialRun);

  useEffect(() => {
    if (flow.state.stage === "finalizing" && flow.finalHistory) {
      router.push(`/results?id=${flow.finalHistory.id}`);
    }
  }, [flow.state.stage, flow.finalHistory, router]);

  const restartTest = useCallback(() => setEpoch((e) => e + 1), []);

  const confirmQuit = (target: string) => {
    const message = flow.progressSaved === true
      ? "已完成的项目会保留。返回后可以从这一项重新开始。确定退出？"
      : "最近的测试进度未保存，退出后需要重做。确定退出？";
    if (window.confirm(message)) router.push(target);
  };

  if (flow.state.stage === "calibration") {
    const skipCalibration = () => flow.finishCalibration(null);
    const calScale = virtualSensitivityScale(
      settings.baseSensitivity,
      settings.dpi,
      settings.screenWidth
    );
    const baseEDpi = Math.round(eDpi(settings.dpi, settings.baseSensitivity));
    return (
      <ArenaScreen
        key={`cal-${epoch}`}
        multiplier={calScale}
        referenceWidth={settings.screenWidth}
        referenceHeight={settings.screenHeight}
        crosshairColor={settings.crosshairColor}
        beforeStart={flow.checkCurrentProgress}
        onQuit={() => confirmQuit("/setup")}
      >
        <CalibrationTest mode={settings.mode} onComplete={flow.finishCalibration} />
        <TopHud
          title="CALIBRATION"
          subtitle={`模拟你当前灵敏度 ${settings.baseSensitivity.toFixed(3)} · eDPI ${baseEDpi}`}
          round="SPEED BASELINE"
          candidate={settings.baseSensitivity.toFixed(3)}
          eDpi={baseEDpi}
        />
        <ReadyOverlay
          title="CALIBRATION"
          description={`先熟悉虚拟准星：它现在按你的真实参数模拟 —— 灵敏度 ${settings.baseSensitivity.toFixed(3)} @ DPI ${settings.dpi}（eDPI ${baseEDpi}，约 ${cmPer360(settings.dpi, settings.baseSensitivity).toFixed(1)} cm/360°）。快速点击随机目标，建立移动与点击基线，不计入正式成绩。`}
          cta="开始校准（锁定鼠标）"
          onSkipCalibration={skipCalibration}
        />
        <PauseOverlay onRestart={restartTest} onQuit={() => confirmQuit("/setup")} onSkipCalibration={skipCalibration} />
        <DebugPanel />
      </ArenaScreen>
    );
  }

  if (flow.state.stage === "testing") {
    const s = flow.state;
    const candEDpi = Math.round(eDpi(settings.dpi, s.currentSensitivity));
    return (
      <ArenaScreen
        key={`${s.round}-${s.candidateIndex}-${s.testIndex}-${epoch}`}
        multiplier={s.multiplier}
        referenceWidth={settings.screenWidth}
        referenceHeight={!initialRun || initialRun.progress.version >= 10 ? settings.screenHeight : undefined}
        crosshairColor={settings.crosshairColor}
        beforeStart={flow.checkCurrentProgress}
        onQuit={() => confirmQuit("/history")}
      >
        {s.testIndex === 0 && (
          <FlickTest
            mode={settings.mode}
            plan={s.plan}
            scoringMethod={initialRun && initialRun.progress.version < 5 ? "hits-only" : "all-attempts"}
            movementSampling={initialRun && initialRun.progress.version < 7 ? "frames" : "events"}
            onComplete={flow.recordTestResult}
          />
        )}
        {s.testIndex === 1 && (
          <TrackingTest
            mode={settings.mode}
            plan={s.plan}
            scoringMethod={initialRun?.progress.version === 1 ? "frames" : "time"}
            eventCoverage={!initialRun || initialRun.progress.version >= 9}
            onComplete={flow.recordTestResult}
          />
        )}
        {s.testIndex === 2 && (
          <MicroAdjustmentTest
            mode={settings.mode}
            plan={s.plan}
            holdSampling={!initialRun || initialRun.progress.version >= 8
              ? "events"
              : initialRun.progress.version >= 4 ? "time-weighted" : "frames"}
            onComplete={flow.recordTestResult}
          />
        )}
        <TopHud
          title={TEST_NAMES[s.testIndex]}
          subtitle={`第 ${s.round} 轮 · 候选 ${s.candidateIndex + 1}/${s.roundCandidates.length}`}
          round={TEST_LABELS[s.testIndex]}
          progressLabel={s.testIndex === 1 ? "跟枪时间" : "目标"}
          candidate={s.currentSensitivity.toFixed(3)}
          eDpi={candEDpi}
        />
        <ReadyOverlay
          title={TEST_NAMES[s.testIndex]}
          description={`候选灵敏度 ${s.currentSensitivity.toFixed(3)} · eDPI ${candEDpi} · 约 ${cmPer360(settings.dpi, s.currentSensitivity).toFixed(1)} cm/360°`}
          hint={testHint(s.testIndex, settings.mode)}
          position={s}
          cta="锁定鼠标并开始"
          progressSaved={flow.progressSaved}
        />
        <PauseOverlay onRestart={restartTest} onQuit={() => confirmQuit("/history")} position={s} progressSaved={flow.progressSaved} />
        <DebugPanel />
      </ArenaScreen>
    );
  }

  if (flow.state.stage === "conflict") {
    return (
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-2xl font-bold">测试进度已变更</h1>
        <p role="alert" className="mt-4 text-dim">浏览器中保存的进度与本页不同。重新载入以查看最新状态。</p>
        <button className="btn-primary mt-6" onClick={() => window.location.reload()}>重新载入进度</button>
      </main>
    );
  }

  if (flow.state.stage === "error") {
    return (
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-2xl font-bold">未获得有效推荐</h1>
        <p role="alert" className="mt-4 text-dim">{flow.error}</p>
        <button className="btn-primary mt-6" onClick={() => router.push("/setup")}>返回设置重新测试</button>
      </main>
    );
  }

  // finalizing
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="mt-4 text-sm text-dim">正在计算推荐结果…</p>
        {flow.storageSaved === false && flow.finalSnapshot ? (
          <div role="alert" className="panel mx-auto mt-6 max-w-sm border-warn/50 p-4 text-sm text-warn">
            结果未能保存到本地历史（浏览器存储可能已满或被禁用）。
            <div className="mt-3"><ExportResultButton snapshot={flow.finalSnapshot} /></div>
            <p className="mt-2 text-[11px] text-dim/80">刷新或关闭页面前请先导出。</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function testHint(idx: number, mode: PlayerSettings["mode"]): string {
  const config = configFor(mode);
  if (idx === 0) return `共 ${config.flickTargets} 个目标。每次点击都会换目标，命中和未命中都计入成绩。`;
  if (idx === 1) return `跟随移动目标 ${config.trackingDurationMs / 1000} 秒，无需点击。`;
  return `共 ${config.microTargets} 个目标。将准星移入圈内并保持 ${config.microHoldMs / 1000} 秒。`;
}

function RoundProgress({ position }: { position: TestPositionProgress }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3 text-left">
      <p className="text-xs text-fg">
        第 {position.round} 轮 · 候选 {position.candidateIndex + 1}/{position.roundCandidates.length}
      </p>
      <ol aria-label="当前候选的测试进度" className="mt-2 flex flex-wrap gap-2 text-xs">
        {TEST_LABELS.map((label, index) => {
          const done = index < position.testIndex;
          const current = index === position.testIndex;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${
                done ? "border-good/30 text-good" : current ? "border-accent/60 text-fg" : "border-line text-dim"
              }`}
            >
              {done ? <Check size={12} aria-hidden="true" /> : null}
              {label}
              {done ? <span className="sr-only">已完成</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-dim">累计完成 {position.completedTests} 项 · 本轮还剩 {position.remainingInRound} 项</p>
    </div>
  );
}

/* ---------- Arena 外壳（全屏） ---------- */
function ArenaScreen({
  multiplier,
  referenceWidth,
  referenceHeight,
  crosshairColor,
  beforeStart,
  onQuit,
  children,
}: {
  multiplier: number;
  referenceWidth: number;
  referenceHeight?: number;
  crosshairColor: string;
  beforeStart: () => boolean;
  onQuit: () => void;
  children: React.ReactNode;
}) {
  return (
    <AimArena multiplier={multiplier} referenceWidth={referenceWidth} referenceHeight={referenceHeight} crosshairColor={crosshairColor} beforeStart={beforeStart}>
      {children}
      <ArenaSizeNotice />
      <ExitTestButton onQuit={onQuit} />
    </AimArena>
  );
}

function ArenaSizeNotice() {
  const { arenaSize } = useAim();
  if (arenaSize !== "too-small") return null;
  return (
    <div className="absolute inset-0 z-[70] overflow-y-auto bg-void px-4 pb-4 pt-16 sm:px-8">
      <div className="mx-auto max-w-md" role="status">
        <h2 className="text-lg font-bold text-warn">测试区域太小</h2>
        <p className="mt-2 text-sm text-dim">
          浏览器窗口至少需要 {MIN_ARENA_WIDTH} × {MIN_ARENA_HEIGHT} 像素。请放大窗口或调小网页缩放。
        </p>
      </div>
    </div>
  );
}

function ExitTestButton({ onQuit }: { onQuit: () => void }) {
  const aim = useAim();
  if (aim.phase === "running") return null;
  return (
    <button
      onClick={onQuit}
      className="absolute right-4 top-4 z-[75] grid h-9 w-9 place-items-center rounded-md border border-line bg-black/60 text-dim transition hover:text-accent hover:border-accent/50"
      aria-label="退出测试"
      title="退出测试"
    >
      <X size={16} />
    </button>
  );
}

/* ---------- 顶部 HUD ---------- */
function TopHud({
  title,
  subtitle,
  round,
  candidate,
  eDpi,
  progressLabel = "目标",
}: {
  title: string;
  subtitle: string;
  round: string;
  candidate: string;
  eDpi: number;
  progressLabel?: string;
}) {
  const { phase, sceneRef, registerOverlay } = useAim();
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      const p = sceneRef.current.progress;
      setProgress(p ? p.label : "");
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, sceneRef]);

  if (phase !== "running") return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[60] flex items-start justify-between gap-2 p-2 sm:p-5">
      <div ref={registerOverlay} className="glass rounded-lg px-2 py-1 sm:px-4 sm:py-3">
        <div className="font-mono text-xs font-bold uppercase text-accent sm:tracking-[0.25em]">{title}</div>
        <div className="mt-0.5 hidden text-xs text-dim sm:block">{subtitle}</div>
        <div className="mt-0.5 flex items-center gap-3 font-mono text-[11px] text-good sm:mt-2">
          <span>{progressLabel} {progress || "—"}</span>
        </div>
      </div>
      <div ref={registerOverlay} className="glass rounded-lg px-2 py-1 text-right sm:px-4 sm:py-3">
        <div className="hidden font-mono text-xs uppercase tracking-widest text-dim sm:block">{round}</div>
        <div className="font-mono text-sm font-bold text-fg sm:text-xl">
          {candidate}
          <span className="ml-2 text-[11px] font-normal text-dim">eDPI {eDpi}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- 就绪覆盖层 ---------- */
function ReadyOverlay({
  title,
  description,
  cta,
  progressSaved,
  hint,
  position,
  onSkipCalibration,
}: {
  title: string;
  description: string;
  cta: string;
  progressSaved?: boolean | null;
  hint?: string;
  position?: TestPositionProgress;
  onSkipCalibration?: () => void;
}) {
  const aim = useAim();
  if (aim.phase !== "idle" || aim.arenaSize !== "ready") return null;

  return (
    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-void/70">
      <div className="panel mx-4 max-h-[calc(100%_-_2rem)] w-full max-w-lg overflow-y-auto p-6 text-center sm:p-8">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-accent/40 bg-accent/10">
          <Crosshair size={26} className="text-accent" />
        </div>
        <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-fg">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-dim">{description}</p>
        {position ? <div className="mt-4"><RoundProgress position={position} /></div> : null}
        {hint ? <p className="mt-3 text-sm text-dim">{hint}</p> : null}
        <button className="btn-primary mt-6 w-full" onClick={aim.requestLockAndStart} autoFocus>
          {cta}
        </button>
        {onSkipCalibration ? <button className="btn-ghost mt-2 w-full" onClick={onSkipCalibration}>跳过校准</button> : null}
        <p className="mt-3 text-[11px] text-dim/70">测试期间将锁定鼠标指针，按 ESC 可暂停</p>
        {progressSaved === false ? <ProgressSaveNotice /> : null}
      </div>
    </div>
  );
}

/* ---------- 暂停覆盖层 ---------- */
function PauseOverlay({
  onRestart,
  onQuit,
  progressSaved,
  position,
  onSkipCalibration,
}: {
  onRestart: () => void;
  onQuit: () => void;
  progressSaved?: boolean | null;
  position?: TestPositionProgress;
  onSkipCalibration?: () => void;
}) {
  const aim = useAim();
  if (aim.phase !== "paused" || aim.arenaSize !== "ready") return null;
  const { restartRequired } = aim;
  const retry = aim.pauseReason ? RETRY_PROMPTS[aim.pauseReason] : null;

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="panel mx-4 max-h-[calc(100%_-_2rem)] w-full max-w-md overflow-y-auto p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-warn/40 bg-warn/10">
          <Pause size={20} className="text-warn" />
        </div>
        <h2 className="text-xl font-bold">{restartRequired ? "测试区域已改变" : retry?.title ?? "测试已暂停"}</h2>
        <p className="mt-2 text-sm text-dim">
          {restartRequired
            ? "请在新尺寸下重做当前项目。之前完成的项目会保留。"
            : retry?.text ?? (onSkipCalibration
              ? "暂停时间不计入校准。恢复时会换一个目标。"
              : "暂停时间不计分。恢复时重做当前目标，跟枪会从本段起点开始。")}
        </p>
        {position ? <div className="mt-4"><RoundProgress position={position} /></div> : null}
        {progressSaved === false ? <ProgressSaveNotice /> : null}
        <div className="mt-6 grid gap-2.5">
          {!restartRequired ? (
            <button className="btn-primary" onClick={aim.resume} autoFocus>
              <Play size={16} /> {retry?.action ?? "恢复测试"}
            </button>
          ) : null}
          {restartRequired || !retry ? (
            <button className={restartRequired ? "btn-primary" : "btn-ghost"} onClick={onRestart} autoFocus={restartRequired}>
              <RotateCcw size={16} /> 重做当前项目
            </button>
          ) : null}
          {onSkipCalibration ? <button className="btn-ghost" onClick={onSkipCalibration}>跳过校准</button> : null}
          <button className="text-xs text-dim hover:text-accent" onClick={onQuit}>
            退出测试
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressSaveNotice() {
  return <p role="status" className="mt-3 text-xs text-warn">最近的进度未能保存到浏览器，请在刷新或关闭前完成测试。</p>;
}
