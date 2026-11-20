import type { CandidateScore } from "@/types";
import { formatMeasuredScore } from "@/lib/result-record";
import { ScoreCard } from "./ScoreCard";

const fields = [
  { label: "甩枪", key: "flickScore", tone: "accent" },
  { label: "跟枪", key: "trackingScore", tone: "accent" },
  { label: "微调", key: "microScore", tone: "accent" },
  { label: "一致性", key: "consistencyScore", tone: "warn" },
  { label: "综合", key: "overallScore", tone: "good" },
] as const;

interface CandidateScoreSummaryProps {
  best: CandidateScore;
  baseline: CandidateScore | null;
  baseSensitivity: number;
}

// 从显示到一位小数的分数计算差值，保持数字和变化量一致。
function scoreChange(previous: number | null, current: number | null) {
  if (previous === null || current === null) return null;
  return (Math.round(current * 10) - Math.round(previous * 10)) / 10;
}

export function CandidateScoreSummary({ best, baseline, baseSensitivity }: CandidateScoreSummaryProps) {
  const compare = baseline !== null && baseline !== best;

  return (
    <>
      <p className="mb-4 text-sm text-dim">
        {compare
          ? `与本次测试起点 ${baseSensitivity.toFixed(3)} 的实测成绩比较。`
          : baseline
            ? `本次实测最高分来自测试起点 ${baseSensitivity.toFixed(3)}。`
            : `测试起点 ${baseSensitivity.toFixed(3)} 缺少完整成绩。`}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {fields.map(({ label, key, tone }) => {
          const value = best[key];
          const previous = baseline?.[key] ?? null;
          const change = scoreChange(previous, value);
          return (
            <ScoreCard
              key={key}
              label={label}
              value={value === null ? "—" : formatMeasuredScore(value)}
              tone={tone}
              sub={compare ? (
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  <span>起点 {previous === null ? "—" : formatMeasuredScore(previous)}</span>
                  {change === null ? null : (
                    <span className={change > 0 ? "font-medium text-good" : change < 0 ? "font-medium text-warn" : "text-dim"}>
                      {change > 0 ? "+" : ""}{change.toFixed(1)} 分
                    </span>
                  )}
                </div>
              ) : undefined}
            />
          );
        })}
      </div>
    </>
  );
}
