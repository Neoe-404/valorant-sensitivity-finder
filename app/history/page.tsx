"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { clearHistory, deleteHistoryRecord, loadHistory } from "@/lib/storage";
import { HistoryChart } from "@/components/results/HistoryChart";
import { History as HistoryIcon, Trash2, ChevronRight, FlaskConical } from "lucide-react";
import type { HistoryRecord } from "@/types";

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRecords(loadHistory());
    setMounted(true);
  }, []);

  const refresh = useCallback(() => {
    setRecords(loadHistory());
    setSelected(null);
  }, []);

  const onDelete = (id: string) => {
    setError(deleteHistoryRecord(id) === null ? "删除未能完成，请检查浏览器存储后重试。" : null);
    refresh();
  };

  const onClear = () => {
    if (window.confirm("确定清空全部历史记录？此操作不可恢复。")) {
      setError(clearHistory() === null ? "清空未能完成，请检查浏览器存储后重试。" : null);
      refresh();
    }
  };

  const selectedRec = records.find((r) => r.id === selected) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">测试历史</h1>
          <p className="mt-2 text-sm text-dim">每次测试的推荐灵敏度趋势。数据仅保存在本机浏览器。</p>
        </div>
        {records.length > 0 ? (
          <button
            className="text-xs text-dim underline-offset-4 transition hover:text-accent hover:underline"
            onClick={onClear}
          >
            清空全部
          </button>
        ) : null}
      </header>

      {error ? <p role="alert" className="mb-4 text-sm text-warn">{error}</p> : null}
      {!mounted ? (
        <div className="h-64 animate-pulse rounded-xl border border-line bg-panel" />
      ) : records.length === 0 ? (
        <div className="panel flex min-h-[40vh] flex-col items-center justify-center text-center">
          <FlaskConical size={36} className="mb-4 text-dim" />
          <p className="font-semibold">暂无历史记录</p>
          <p className="mt-1 text-sm text-dim">完成一次灵敏度测试后，结果会自动保存在这里。</p>
          <Link href="/test" className="btn-primary mt-6">开始第一次测试</Link>
        </div>
      ) : (
        <>
          {/* 趋势图 */}
          <section className="panel p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <HistoryIcon size={18} className="text-accent" />
              推荐灵敏度趋势
            </h2>
            <HistoryChart records={records} />
          </section>

          {/* 列表 */}
          <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="panel divide-y divide-line/60">
              {records
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((r) => (
                  <div
                    key={r.id}
                    className={`group flex cursor-pointer items-center justify-between px-4 py-3.5 transition ${
                      selected === r.id ? "bg-accent/5" : "hover:bg-panel-2"
                    }`}
                    onClick={() => setSelected(selected === r.id ? null : r.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-center">
                        <div className="font-mono text-lg font-bold text-accent">{r.recommendedSensitivity.toFixed(3)}</div>
                        <div className="text-[10px] uppercase text-dim">eDPI {Math.round(r.snapshot.recommendation.eDpi)}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-fg">
                          {new Date(r.date).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="mt-0.5 text-xs text-dim">
                          {r.rounds} rounds · {r.snapshot.candidates.length} candidates ·{" "}
                          <span
                            className={
                              r.snapshot.recommendation.confidenceLabel === "High"
                                ? "text-good"
                                : r.snapshot.recommendation.confidenceLabel === "Low"
                                  ? "text-warn"
                                  : "text-accent"
                            }
                          >
                            {r.snapshot.recommendation.confidenceLabel} {r.snapshot.recommendation.confidence}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="grid h-8 w-8 place-items-center rounded-md text-dim opacity-0 transition hover:bg-accent/10 hover:text-accent group-hover:opacity-100"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(r.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                      <ChevronRight size={16} className={`text-dim transition ${selected === r.id ? "rotate-90" : ""}`} />
                    </div>
                  </div>
                ))}
            </div>

            {/* 详情 */}
            <div className="panel p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-dim">详情</h2>
              {!selectedRec ? (
                <p className="text-sm text-dim">点击左侧记录查看详情。</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-dim">推荐灵敏度</div>
                    <div className="mt-1 font-mono text-3xl font-bold text-accent">
                      {selectedRec.recommendedSensitivity.toFixed(3)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-dim">推荐区间</div>
                    <div className="mt-1 font-mono text-sm text-fg">
                      {selectedRec.snapshot.recommendation.rangeMin.toFixed(3)} ~{" "}
                      {selectedRec.snapshot.recommendation.rangeMax.toFixed(3)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-dim">DPI</div>
                      <div className="mt-0.5 font-mono text-fg">{selectedRec.snapshot.settings.dpi}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-dim">eDPI</div>
                      <div className="mt-0.5 font-mono text-fg">
                        {Math.round(selectedRec.snapshot.recommendation.eDpi)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-dim">模式</div>
                      <div className="mt-0.5 text-fg">
                        {selectedRec.snapshot.settings.mode === "standard" ? "标准" : "快速"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-dim">轮数</div>
                      <div className="mt-0.5 text-fg">{selectedRec.rounds}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-dim">问题分析</div>
                    <ul className="mt-2 space-y-1.5">
                      {selectedRec.snapshot.analysis.slice(0, 3).map((a, i) => (
                        <li key={i} className="text-xs text-dim">
                          · {a.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Link
                    href={`/results?id=${selectedRec.id}`}
                    className="btn-ghost w-full text-sm"
                  >
                    查看完整结果
                  </Link>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
