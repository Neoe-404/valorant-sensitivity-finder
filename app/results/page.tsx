"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getHistoryRecord, getSessionForResults } from "@/lib/storage";
import { SensitivityResult } from "@/components/results/SensitivityResult";
import { AimProfileChart } from "@/components/results/AimProfileChart";
import { ScoreCard } from "@/components/results/ScoreCard";
import { Crosshair, TrendingUp, AlertTriangle, CheckCircle2, Info, History } from "lucide-react";
import type { SessionSnapshot } from "@/types";

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl px-4 py-20">
          <div className="h-96 animate-pulse rounded-xl border border-line bg-panel" />
        </main>
      }
    >
      <ResultsContent />
    </Suspense>
  );
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "empty">("loading");
  const [unsaved, setUnsaved] = useState(false);

  useEffect(() => {
    const id = searchParams.get("id");
    const snap = getSessionForResults(id);
    setSnapshot(snap);
    setUnsaved(Boolean(snap && !getHistoryRecord(snap.id)));
    if (snap) {
      setSnapshot(snap);
      setPhase("ready");
    } else {
      setPhase("empty");
    }
  }, [searchParams]);

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-20">
        <div className="h-96 animate-pulse rounded-xl border border-line bg-panel" />
      </main>
    );
  }

  if (phase === "empty" || !snapshot) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <Crosshair size={40} className="mb-6 text-accent" />
        <h1 className="text-2xl font-bold">{searchParams.get("id") ? "未找到这次测试结果" : "还没有测试结果"}</h1>
        <p className="mt-3 text-sm text-dim">记录可能已删除或未保存。完成一次完整测试后，这里会展示你的结果。</p>
        <Link href="/test" className="btn-primary mt-6">去测试</Link>
      </main>
    );
  }

  const { recommendation: rec, profile, analysis, candidates, calibration, settings } = snapshot;
  const exportResult = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sensitivity-result-${snapshot.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const best = [...candidates]
    .filter((c) => c.finished && c.overallScore !== null)
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))[0];

  const sevIcon = (s: string) =>
    s === "good" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" /> : s === "warn" ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" /> : <Info size={15} className="mt-0.5 shrink-0 text-accent" />;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">测试结果</h1>
        <p className="mt-2 text-sm text-dim">
          {settings.baseSensitivity.toFixed(3)} → {rec.sensitivity.toFixed(3)} ·
          经过 {snapshot.rounds} 轮搜索、{candidates.length} 个候选灵敏度
        </p>
      </header>

      {/* 推荐 */}
      {unsaved ? (
        <div role="alert" className="panel mb-6 border-warn/50 p-4 text-sm text-warn">
          本次结果未保存到历史。请导出结果后再刷新或关闭页面。
          <button className="btn-ghost ml-3" onClick={exportResult}>导出结果</button>
        </div>
      ) : null}
      <SensitivityResult rec={rec} />

      {/* 成绩卡 */}
      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">最佳候选成绩</h2>
        {best ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <ScoreCard label="Flick" value={Math.round(best.flickScore ?? 0)} tone="accent" />
            <ScoreCard label="Tracking" value={Math.round(best.trackingScore ?? 0)} tone="accent" />
            <ScoreCard label="Micro" value={Math.round(best.microScore ?? 0)} tone="accent" />
            <ScoreCard label="Consistency" value={Math.round(best.consistencyScore ?? 0)} tone="warn" />
            <ScoreCard label="Overall" value={Math.round(best.overallScore ?? 0)} tone="good" />
          </div>
        ) : null}
      </section>

      {/* 画像 + 分析 */}
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="mb-2 text-lg font-semibold">Aim Profile</h2>
          <p className="mb-4 text-xs text-dim">六维瞄准画像（0~100）</p>
          <AimProfileChart profile={profile} />
        </div>

        <div className="panel p-6">
          <h2 className="mb-4 text-lg font-semibold">灵敏度问题分析</h2>
          <div className="space-y-3">
            {analysis.map((a, i) => (
              <div key={i} className="flex gap-3 rounded-lg border border-line bg-panel-2 p-3">
                {sevIcon(a.severity)}
                <div>
                  <div className="text-sm font-medium text-fg">{a.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-dim">{a.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 校准基线 */}
      {calibration ? (
        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ScoreCard label="校准移动速度" value={Math.round(calibration.avgMoveSpeed)} sub="px/s" />
          <ScoreCard label="校准点击延迟" value={Math.round(calibration.avgClickDelay)} sub="ms" />
          <ScoreCard label="校准命中率" value={Math.round(calibration.hitRate * 100)} sub="基线" />
          <ScoreCard label="校准目标数" value={Math.round(calibration.clicks)} sub="不计成绩" />
        </section>
      ) : null}

      {/* 候选表 */}
      <section className="mt-8">
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-dim">
                <th className="px-4 py-3">Round</th>
                <th className="px-4 py-3">Sensitivity</th>
                <th className="px-4 py-3">×Multiplier</th>
                <th className="px-4 py-3">Flick</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Micro</th>
                <th className="px-4 py-3">Overall</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={`${c.round}-${c.sensitivity}`} className="border-b border-line/50 font-mono text-xs">
                  <td className="px-4 py-2.5 text-dim">{c.round}</td>
                  <td className="px-4 py-2.5 text-fg">{c.sensitivity.toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-dim">×{c.multiplier.toFixed(2)}</td>
                  <td className="px-4 py-2.5">{Math.round(c.flickScore ?? 0)}</td>
                  <td className="px-4 py-2.5">{Math.round(c.trackingScore ?? 0)}</td>
                  <td className="px-4 py-2.5">{Math.round(c.microScore ?? 0)}</td>
                  <td className="px-4 py-2.5 font-bold text-good">{Math.round(c.overallScore ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 操作 */}
      <section className="mt-8 flex flex-wrap gap-3">
        <Link href="/test" className="btn-primary">
          <TrendingUp size={16} /> 再测一轮
        </Link>
        <Link href="/history" className="btn-ghost">
          <History size={16} /> 查看历史
        </Link>
      </section>
    </main>
  );
}
