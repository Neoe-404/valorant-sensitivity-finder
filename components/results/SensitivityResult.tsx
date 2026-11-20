"use client";

import { useEffect, useRef, useState } from "react";
import type { SensitivityRecommendation } from "@/types";
import { Copy, Check } from "lucide-react";
import { cmPer360 } from "@/lib/mouse-math";

interface SensitivityResultProps {
  rec: SensitivityRecommendation;
  wasTested: boolean;
}

export function SensitivityResult({ rec, wasTested }: SensitivityResultProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "manual">("idle");
  const valueRef = useRef<HTMLSpanElement>(null);
  const value = rec.sensitivity.toFixed(3);
  const copied = copyStatus === "copied";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const labelColor =
    rec.confidenceLabel === "High"
      ? "text-good border-good/40 bg-good/10"
      : rec.confidenceLabel === "Low"
        ? "text-warn border-warn/40 bg-warn/10"
        : "text-accent border-accent/40 bg-accent/10";

  const copy = async () => {
    const valueNode = valueRef.current;
    if (!valueNode || copyStatus === "copying") return;
    setCopyStatus("copying");

    let success = false;
    try {
      await navigator.clipboard.writeText(value);
      success = true;
    } catch {
      if (!valueNode.isConnected) return;
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(valueNode);
        selection.removeAllRanges();
        selection.addRange(range);
        try {
          success = document.execCommand("copy");
        } catch {
          success = false;
        }
        if (success) selection.removeAllRanges();
      }
    }
    if (valueNode.isConnected) setCopyStatus(success ? "copied" : "manual");
  };

  return (
    <div className="panel relative overflow-hidden p-6 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-accent/60 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-xs tracking-widest text-dim">推荐灵敏度</div>
          <div className="mt-2 flex items-center gap-3">
            <span ref={valueRef} className="select-text font-mono text-5xl font-bold text-fg sm:text-6xl">
              {value}
            </span>
            <button
              type="button"
              onClick={copy}
              aria-label="复制灵敏度"
              title="复制灵敏度"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-dim transition hover:border-accent hover:text-accent"
            >
              {copied ? <Check size={18} className="text-good" /> : <Copy size={18} />}
            </button>
          </div>
          <p role="status" className={copyStatus === "manual" ? "mt-2 text-xs text-warn" : "sr-only"}>
            {copied ? "已复制灵敏度。" : copyStatus === "manual" ? "自动复制失败，请手动复制上方数值。" : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dim">
            <span className="rounded border border-line bg-panel-2 px-2 py-1 font-mono">
              DPI {rec.dpi}
            </span>
            <span className="rounded border border-line bg-panel-2 px-2 py-1 font-mono">
              eDPI {rec.eDpi}
            </span>
            <span className="rounded border border-line bg-panel-2 px-2 py-1 font-mono">
              ≈ {cmPer360(rec.dpi, rec.sensitivity).toFixed(1)} cm/360°
            </span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${labelColor}`}>
            置信指标 · {rec.confidenceLabel} ({rec.confidence}%)
          </span>
          <div className="sm:text-right">
            <div className="text-xs tracking-widest text-dim">推荐区间</div>
            <div className="mt-1 font-mono text-lg text-fg">
              {rec.rangeMin === rec.rangeMax
                ? rec.rangeMin.toFixed(3)
                : `${rec.rangeMin.toFixed(3)} ~ ${rec.rangeMax.toFixed(3)}`}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2 border-t border-line pt-4 text-xs text-dim">
        <p>根据 {rec.basisCount} 个实测候选的综合分计算。{wasTested ? "推荐值有对应实测成绩。" : "推荐值尚未单独实测，可在游戏内试用。"}{" "}
          <a href="#candidate-scores" className="text-accent underline underline-offset-4">查看候选成绩</a>
        </p>
        {rec.hasSeparatedHighScores ? <p className="text-warn">{rec.reason}</p> : null}
        <p>置信指标为经验估计，供试用时参考。</p>
      </div>
    </div>
  );
}
