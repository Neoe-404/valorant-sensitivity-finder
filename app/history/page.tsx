"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { clearHistory, deleteHistoryRecord, historyBackup, importHistoryFile, loadHistory, MAX_HISTORY_FILE_BYTES } from "@/lib/storage";
import { analyzeResult } from "@/lib/analysis-engine";
import { JsonDownloadButton } from "@/components/results/JsonDownloadButton";
import { History as HistoryIcon, Trash2, ChevronRight, FlaskConical, Upload } from "lucide-react";
import type { HistoryRecord } from "@/types";

const importErrors = {
  invalid: "无法识别或还原此文件。请选择结果 JSON 或历史备份。",
  "too-large": "文件超过导入大小限制。请选择结果 JSON 或历史备份。",
  "active-test": "文件中有当前可继续的测试。请先到测试页处理该进度。",
  full: "历史已达到记录上限，或浏览器存储空间不足。请清出空间后重试。",
  unavailable: "无法写入浏览器存储，请检查站点设置后重试。",
};
const recordDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

// recharts 仅历史页使用，按需加载减小首屏 JS
const HistoryChart = dynamic(
  () => import("@/components/results/HistoryChart").then((m) => m.HistoryChart),
  {
    ssr: false,
    loading: () => <div className="h-64 w-full animate-pulse rounded-lg border border-line bg-panel" />,
  }
);

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<{ message: string; id?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecords(loadHistory());
    setMounted(true);
  }, []);

  const refresh = useCallback(() => {
    const updated = loadHistory();
    setRecords(updated);
    setSelected((id) => updated.some((record) => record.id === id) ? id : null);
    setImportNotice(null);
  }, []);

  // 其他标签页写入/删除历史时自动刷新
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("vsf:")) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const onDelete = (id: string) => {
    if (!window.confirm("确定删除这条记录？此操作不可恢复。")) return;
    setError(deleteHistoryRecord(id) === null ? "删除未能完成，请检查浏览器存储后重试。" : null);
    refresh();
  };

  const onClear = () => {
    if (window.confirm("确定清空全部历史记录？此操作不可恢复。")) {
      setError(clearHistory() === null ? "清空未能完成，请检查浏览器存储后重试。" : null);
      refresh();
    }
  };

  const onImport = async (file: File) => {
    setError(null);
    setImportNotice(null);
    if (file.size > MAX_HISTORY_FILE_BYTES) {
      setError(importErrors["too-large"]);
      return;
    }
    setImporting(true);
    try {
      const outcome = importHistoryFile(await file.text(), file.size);
      if ("id" in outcome) {
        setRecords(loadHistory());
        setSelected(outcome.id);
        setImportNotice({ id: outcome.id, message: outcome.status === "duplicate" ? "这次测试已在历史中。" : "已导入测试结果。" });
      } else if (outcome.status === "restored") {
        setRecords(loadHistory());
        setImportNotice({
          message: `恢复 ${outcome.imported} 条记录${outcome.skipped ? `，跳过 ${outcome.skipped} 条重复记录` : ""}。`,
        });
      } else {
        setError(importErrors[outcome.status]);
      }
    } catch {
      setError("无法读取该文件，请重新选择。");
    } finally {
      setImporting(false);
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
        <div className="flex flex-wrap items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={importing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void onImport(file);
            }}
          />
          <button
            type="button"
            className="btn-ghost disabled:opacity-40"
            disabled={!mounted || importing}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={16} /> {importing ? "正在导入…" : "导入 JSON"}
          </button>
          {records.length > 0 ? (
            <>
              <JsonDownloadButton label="备份历史" filename="sensitivity-history-v1.json" data={historyBackup(records)} />
              <button
                className="text-xs text-dim underline-offset-4 transition hover:text-accent hover:underline"
                onClick={onClear}
              >
                清空全部
              </button>
            </>
          ) : null}
        </div>
      </header>

      {error ? <p role="alert" className="mb-4 text-sm text-warn">{error}</p> : null}
      {importNotice ? (
        <p role="status" className="mb-4 text-sm text-fg">
          {importNotice.message}{" "}
          {importNotice.id ? (
            <Link className="text-accent underline underline-offset-4" href={`/results?id=${importNotice.id}`}>查看结果</Link>
          ) : null}
        </p>
      ) : null}
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
              测试趋势
            </h2>
            <HistoryChart records={records} />
          </section>

          {/* 列表 */}
          <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_340px]">
            <ul aria-label="测试记录" className="panel min-w-0 divide-y divide-line/60">
              {records
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((r) => (
                  <li
                    key={r.id}
                    className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 transition ${
                      selected === r.id ? "bg-accent/5" : "hover:bg-panel-2"
                    }`}
                  >
                    <button
                      type="button"
                      aria-controls="history-record-details"
                      aria-expanded={selected === r.id}
                      className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 rounded-md px-2 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={() => setSelected((id) => id === r.id ? null : r.id)}
                    >
                      <span className="shrink-0 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-center">
                        <span className="block font-mono text-lg font-bold text-accent">{r.recommendedSensitivity.toFixed(3)}</span>
                        <span className="block text-[10px] text-dim">eDPI {Math.round(r.snapshot.recommendation.eDpi)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <time dateTime={r.date} className="block text-sm font-medium text-fg">
                          {recordDate.format(new Date(r.date))}
                        </time>
                        <span className="mt-0.5 block text-xs text-dim">
                          {r.rounds} 轮 · {r.snapshot.candidates.length} 个候选 ·{" "}
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
                        </span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" className={`shrink-0 text-dim transition ${selected === r.id ? "rotate-90" : ""}`} />
                    </button>
                    {selected === r.id ? (
                      <Link href={`/results?id=${r.id}`} className="col-start-1 row-start-2 mx-2 mb-3 w-fit rounded text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">
                        查看完整结果
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="col-start-2 row-start-1 grid h-8 w-8 place-items-center rounded-md text-dim opacity-60 transition hover:bg-accent/10 hover:text-accent group-hover:opacity-100 focus-visible:opacity-100"
                      title="删除"
                      aria-label="删除该记录"
                      onClick={() => onDelete(r.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
            </ul>

            {/* 详情 */}
            <div id="history-record-details" className="panel p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-dim">详情</h2>
              {!selectedRec ? (
                <p className="text-sm text-dim">选择一条记录查看详情。</p>
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
                      {analyzeResult(selectedRec.snapshot).analysis.slice(0, 3).map((a, i) => (
                        <li key={i} className="text-xs text-dim">
                          · {a.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
