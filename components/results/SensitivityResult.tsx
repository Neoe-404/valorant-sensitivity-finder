"use client";

import type { SensitivityRecommendation } from "@/types";
import { ShieldCheck, Activity } from "lucide-react";
import { cmPer360 } from "@/lib/mouse-math";

interface SensitivityResultProps {
  rec: SensitivityRecommendation;
}

export function SensitivityResult({ rec }: SensitivityResultProps) {
  const labelColor =
    rec.confidenceLabel === "High"
      ? "text-good border-good/40 bg-good/10"
      : rec.confidenceLabel === "Low"
        ? "text-warn border-warn/40 bg-warn/10"
        : "text-accent border-accent/40 bg-accent/10";

  return (
    <div className="panel relative overflow-hidden p-6 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-accent/60 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-dim">Your Sensitivity</div>
          <div className="mt-2 font-mono text-5xl font-bold text-fg sm:text-6xl">
            {rec.sensitivity.toFixed(3)}
          </div>
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
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest text-dim">Recommended Range</div>
            <div className="mt-1 font-mono text-lg text-fg">
              {rec.rangeMin.toFixed(3)} ~ {rec.rangeMax.toFixed(3)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2 border-t border-line pt-4 text-xs text-dim">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-accent" />
          <span>推荐值由 {rec.basisCount} 个候选灵敏度按实际成绩加权计算</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent" />
          <span>{rec.reason}</span>
        </div>
        <p>置信指标为经验估计，不代表统计置信概率；请在游戏内复核手感。</p>
      </div>
    </div>
  );
}
