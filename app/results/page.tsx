"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { getHistoryRecord, getSessionForResults, loadTestProgress } from "@/lib/storage";
import { analyzeResult } from "@/lib/analysis-engine";
import { roundSensitivity } from "@/lib/mouse-math";
import { SensitivityResult } from "@/components/results/SensitivityResult";
import { ScoreCard } from "@/components/results/ScoreCard";
import { ExportResultButton } from "@/components/results/ExportResultButton";
import { Crosshair, TrendingUp, AlertTriangle, CheckCircle2, Info, History } from "lucide-react";
import type { SessionSnapshot } from "@/types";

// recharts 仅结果页使用，按需加载减小首屏 JS
const AimProfileChart = dynamic(
  () => import("@/components/results/AimProfileChart").then((m) => m.AimProfileChart),
  {
    ssr: false,
    loading: () => <div className="h-72 w-full animate-pulse rounded-lg border border-line bg-panel" />,
  }
);

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
  const [hasProgress, setHasProgress] = useState(false);

  useEffect(() => {
    const id = searchParams.get("id");
    const snap = getSessionForResults(id);
    const missingHistory = Boolean(snap && !getHistoryRecord(snap.id));
    setSnapshot(snap);
    setUnsaved(missingHistory);
    setHasProgress(missingHistory && loadTestProgress()?.id === snap?.id);
    setPhase(snap ? "ready" : "empty");
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

  const { recommendation: rec, profile, candidates, calibration, settings } = snapshot;
  const { best, analysis } = analyzeResult(snapshot);
  const recommendationTested = candidates.some((c) =>
    c.finished && c.overallScore !== null && c.sensitivity === rec.sensitivity
  );
  const baseline = roundSensitivity(settings.baseSensitivity);
  const basis = new Set(rec.basis);

  // 未完成的候选分数显示为「—」，避免与真实 0 分混淆
  const scoreCell = (v: number | null) =>
    v === null ? <span className="text-dim">—</span> : Math.round(v);

  const sevIcon = (s: string) =>
    s === "good" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" /> : s === "warn" ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" /> : <Info size={15} className="mt-0.5 shrink-0 text-accent" />;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">测试结果</h1>
          <p className="mt-2 text-sm text-dim">
            {settings.baseSensitivity.toFixed(3)} → {rec.sensitivity.toFixed(3)} ·
            经过 {snapshot.rounds} 轮搜索、{candidates.length} 个候选灵敏度
          </p>
        </div>
        <ExportResultButton key={snapshot.id} snapshot={{ ...snapshot, analysis }} />
      </header>

      {/* 推荐 */}
      {unsaved ? (
        <div role="alert" className="panel mb-6 border-warn/50 p-4 text-sm text-warn">
          <p>本次结果未保存到历史。{hasProgress ? "可以返回测试页查看已保存的进度。" : "请导出结果后再刷新或关闭页面。"}</p>
          {hasProgress ? <Link href="/test" className="btn-ghost mt-3">查看已保存进度</Link> : null}
        </div>
      ) : null}
      <SensitivityResult key={snapshot.id} rec={rec} wasTested={recommendationTested} />

      {/* 成绩卡 */}
      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">
          {best ? `实测最高分 · 灵敏度 ${best.sensitivity.toFixed(3)}` : "实测成绩"}
        </h2>
        {best ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <ScoreCard label="甩枪" value={Math.round(best.flickScore ?? 0)} tone="accent" />
            <ScoreCard label="跟枪" value={Math.round(best.trackingScore ?? 0)} tone="accent" />
            <ScoreCard label="微调" value={Math.round(best.microScore ?? 0)} tone="accent" />
            <ScoreCard label="一致性" value={Math.round(best.consistencyScore ?? 0)} tone="warn" />
            <ScoreCard label="综合" value={Math.round(best.overallScore ?? 0)} tone="good" />
          </div>
        ) : (
          <div className="panel p-6 text-center text-sm text-dim">
            暂无完整候选数据，可能本次测试未正常完成。
            <div className="mt-3">
              <Link href="/test" className="btn-ghost">再测一轮</Link>
            </div>
          </div>
        )}
      </section>

      {/* 画像 + 分析 */}
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="mb-2 text-lg font-semibold">瞄准画像</h2>
          <p className="mb-4 text-xs text-dim">六维瞄准画像（0~100）{best ? `，基于灵敏度 ${best.sensitivity.toFixed(3)} 的实测成绩` : ""}</p>
          <AimProfileChart profile={profile} />
        </div>

        <div className="panel p-6">
          <h2 className="mb-4 text-lg font-semibold">表现分析</h2>
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
      <section id="candidate-scores" className="mt-8 scroll-mt-20" aria-labelledby="candidate-scores-title">
        <h2 id="candidate-scores-title" className="mb-4 text-lg font-semibold">候选成绩</h2>
        <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-labelledby="candidate-scores-title">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-dim">
                <th scope="col" className="px-4 py-3 whitespace-nowrap">轮次</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">灵敏度</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">倍率</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">甩枪</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">跟枪</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">微调</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">综合</th>
                <th scope="col" className="px-4 py-3 whitespace-nowrap">备注</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={`${c.round}-${c.sensitivity}`} className="border-b border-line/50 font-mono text-xs">
                  <td className="px-4 py-2.5 text-dim">{c.round}</td>
                  <th scope="row" className="px-4 py-2.5 font-medium text-fg">{c.sensitivity.toFixed(3)}</th>
                  <td className="px-4 py-2.5 text-dim">×{c.multiplier.toFixed(2)}</td>
                  <td className="px-4 py-2.5">{scoreCell(c.flickScore)}</td>
                  <td className="px-4 py-2.5">{scoreCell(c.trackingScore)}</td>
                  <td className="px-4 py-2.5">{scoreCell(c.microScore)}</td>
                  <td className="px-4 py-2.5 font-bold text-good">{scoreCell(c.overallScore)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1 whitespace-nowrap font-sans">
                      {c === best ? <span className="rounded bg-good/10 px-1.5 py-0.5 text-good">最高分</span> : null}
                      {c.sensitivity === baseline ? <span className="rounded bg-panel-2 px-1.5 py-0.5 text-dim">当前设置</span> : null}
                      {c.finished && c.overallScore !== null && basis.has(c.sensitivity) ? (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">计入推荐</span>
                      ) : null}
                    </div>
                  </td>
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
