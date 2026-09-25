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
import { useSensitivitySession } from "@/hooks/useSensitivitySession";
import { loadSettings } from "@/lib/storage";
import { virtualSensitivityScale, cmPer360 } from "@/lib/mouse-math";
import { Crosshair, Pause, Play, RotateCcw, X } from "lucide-react";
import type { CalibrationResult, FlickResult, MicroResult, PlayerSettings, TrackingResult } from "@/types";

const TEST_NAMES = ["FLICK TEST", "TRACKING TEST", "MICRO TEST"] as const;

export default function TestPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [mobile, setMobile] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const flow = useSensitivitySession(
    settings ?? {
      dpi: 800,
      baseSensitivity: 0.35,
      skillLevel: "average",
      playstyle: "mixed",
      hand: "right",
      screenWidth: 1920,
      screenHeight: 1080,
      mode: "standard",
      crosshairColor: "#52f485",
    }
  );

  useEffect(() => {
    const saved = loadSettings();
    if (!saved) {
      router.replace("/setup");
      return;
    }
    setSettings(saved);
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    const check = () => setMobile(mq.matches);
    check();
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, []);

  const onTestComplete = useCallback(
    (result: FlickResult | TrackingResult | MicroResult) => {
      flow.recordTestResult(result);
    },
    [flow]
  );

  // 测试全部完成 → 结果页
  useEffect(() => {
    if (flow.state.stage === "finalizing") {
      if (flow.finalHistory) {
        router.push(`/results?id=${flow.finalHistory.id}`);
      }
    }
  }, [flow.state.stage, flow.finalHistory, router]);

  const onCalibrationComplete = useCallback(
    (cal: CalibrationResult) => flow.finishCalibration(cal),
    [flow]
  );

  const restartTest = useCallback(() => setEpoch((e) => e + 1), []);

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

  if (!settings) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20">
        <div className="h-24 animate-pulse rounded-xl border border-line bg-panel" />
      </main>
    );
  }

  if (flow.state.stage === "calibration") {
    const calScale = virtualSensitivityScale(
      settings.baseSensitivity,
      settings.dpi,
      settings.screenWidth
    );
    return (
      <ArenaScreen
        key={`cal-${epoch}`}
        multiplier={calScale}
        referenceWidth={settings.screenWidth}
        crosshairColor={settings.crosshairColor}
        onQuit={() => router.push("/setup")}
      >
        <CalibrationTest mode={settings.mode} onComplete={onCalibrationComplete} />
        <TopHud
          title="CALIBRATION"
          subtitle={`模拟你当前灵敏度 ${settings.baseSensitivity.toFixed(3)} · eDPI ${Math.round(settings.dpi * settings.baseSensitivity)}`}
          round="SPEED BASELINE"
          candidate={settings.baseSensitivity.toFixed(3)}
          eDpi={Math.round(settings.dpi * settings.baseSensitivity)}
        />
        <ReadyOverlay
          title="CALIBRATION"
          description={`先熟悉虚拟准星：它现在按你的真实参数模拟 —— 灵敏度 ${settings.baseSensitivity.toFixed(3)} @ DPI ${settings.dpi}（eDPI ${Math.round(settings.dpi * settings.baseSensitivity)}，约 ${cmPer360(settings.dpi, settings.baseSensitivity).toFixed(1)} cm/360°）。快速点击随机目标，建立移动与点击基线，不计入正式成绩。`}
          cta="开始校准（锁定鼠标）"
        />
        <PauseOverlay onRestart={restartTest} onQuit={() => router.push("/setup")} />
        <DebugPanel />
      </ArenaScreen>
    );
  }

  if (flow.state.stage === "testing") {
    const s = flow.state;
    return (
      <ArenaScreen
        key={`${s.round}-${s.candidateIndex}-${s.testIndex}-${epoch}`}
        multiplier={s.multiplier}
        referenceWidth={settings.screenWidth}
        crosshairColor={settings.crosshairColor}
        onQuit={() => router.push("/history")}
      >
        {s.testIndex === 0 && <FlickTest mode={settings.mode} onComplete={onTestComplete} />}
        {s.testIndex === 1 && <TrackingTest mode={settings.mode} onComplete={onTestComplete} />}
        {s.testIndex === 2 && <MicroAdjustmentTest mode={settings.mode} onComplete={onTestComplete} />}
        <TopHud
          title={TEST_NAMES[s.testIndex]}
          subtitle={`Round ${s.round} · Candidate ${s.candidateIndex + 1}/${s.roundCandidates.length}`}
          round={`ROUND ${s.round}`}
          candidate={s.currentSensitivity.toFixed(3)}
          eDpi={Math.round(s.currentSensitivity * settings.dpi)}
        />
        <ReadyOverlay
          title={TEST_NAMES[s.testIndex]}
          description={`第 ${s.round} 轮 · 候选灵敏度 ${s.currentSensitivity.toFixed(3)}（eDPI ${Math.round(s.currentSensitivity * settings.dpi)}，约 ${cmPer360(settings.dpi, s.currentSensitivity).toFixed(1)} cm/360°）。规则：${testHint(s.testIndex, settings.mode)}`}
          cta="锁定鼠标并开始"
        />
        <PauseOverlay onRestart={restartTest} onQuit={() => router.push("/history")} />
        <DebugPanel />
      </ArenaScreen>
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
      </div>
    </main>
  );
}

function testHint(idx: number, mode: PlayerSettings["mode"]): string {
  if (idx === 0) return `点击目标后生成下一个，命中或未命中都会记录，共 ${configFor(mode).flickTargets} 个目标`;
  if (idx === 1) return "跟随移动目标，无需点击，结束后自动统计";
  return "目标很小且靠近准星，进入半径并稳定保持片刻才算命中";
}

/* ---------- Arena 外壳（全屏） ---------- */
function ArenaScreen({
  multiplier,
  referenceWidth,
  crosshairColor,
  onQuit,
  children,
}: {
  multiplier: number;
  referenceWidth: number;
  crosshairColor: string;
  onQuit: () => void;
  children: React.ReactNode;
}) {
  return (
    <AimArena multiplier={multiplier} referenceWidth={referenceWidth} crosshairColor={crosshairColor}>
      {children}
      {/* 顶部退出按钮 */}
      <div className="absolute right-4 top-4 z-[60] flex gap-2">
        <button
          onClick={onQuit}
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-md border border-line bg-black/60 text-dim transition hover:text-accent hover:border-accent/50"
          title="退出测试"
        >
          <X size={16} />
        </button>
      </div>
    </AimArena>
  );
}

/* ---------- 顶部 HUD ---------- */
function TopHud({
  title,
  subtitle,
  round,
  candidate,
  eDpi,
}: {
  title: string;
  subtitle: string;
  round: string;
  candidate: string;
  eDpi: number;
}) {
  const aim = useAim();
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = aim.sceneRef.current?.progress;
      setProgress(p ? p.label : "");
    }, 100);
    return () => window.clearInterval(id);
  }, [aim]);

  if (aim.phase === "idle") return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[60] flex items-start justify-between p-4 sm:p-5">
      <div className="glass rounded-lg px-4 py-3">
        <div className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-accent">{title}</div>
        <div className="mt-0.5 text-xs text-dim">{subtitle}</div>
        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-good">
          <span>Target {progress || "—"}</span>
        </div>
      </div>
      <div className="glass rounded-lg px-4 py-3 text-right">
        <div className="font-mono text-xs uppercase tracking-widest text-dim">{round}</div>
        <div className="font-mono text-xl font-bold text-fg">
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
}: {
  title: string;
  description: string;
  cta: string;
}) {
  const aim = useAim();
  if (aim.phase !== "idle") return null;

  return (
    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-void/70">
      <div className="panel mx-4 max-w-lg p-8 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-accent/40 bg-accent/10">
          <Crosshair size={26} className="text-accent" />
        </div>
        <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-fg">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-dim">{description}</p>
        <button className="btn-primary mt-6 w-full" onClick={aim.requestLockAndStart}>
          {cta}
        </button>
        <p className="mt-3 text-[11px] text-dim/70">测试期间将锁定鼠标指针，按 ESC 可暂停</p>
      </div>
    </div>
  );
}

/* ---------- 暂停覆盖层 ---------- */
function PauseOverlay({ onRestart, onQuit }: { onRestart: () => void; onQuit: () => void }) {
  const aim = useAim();
  if (aim.phase !== "paused") return null;

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="panel mx-4 max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-warn/40 bg-warn/10">
          <Pause size={20} className="text-warn" />
        </div>
        <h2 className="text-xl font-bold">测试已暂停</h2>
        <p className="mt-2 text-sm text-dim">
          测试已暂停，暂停时间不计分。恢复时重做当前目标；跟踪测试会重新开始这一段。
        </p>
        <div className="mt-6 grid gap-2.5">
          <button className="btn-primary" onClick={aim.resume}>
            <Play size={16} /> 恢复测试
          </button>
          <button className="btn-ghost" onClick={onRestart}>
            <RotateCcw size={16} /> 重新开始本次测试
          </button>
          <button className="text-xs text-dim hover:text-accent" onClick={onQuit}>
            放弃本轮并退出
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 进度轮询（连接 Canvas 场景与 React HUD） ---------- */
/* HUD 组件内直接使用 aim.sceneRef 轮询，此处无额外实现。 */
