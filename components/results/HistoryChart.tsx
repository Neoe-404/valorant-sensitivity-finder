"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { eDpi } from "@/lib/mouse-math";
import type { HistoryRecord } from "@/types";

interface HistoryChartProps {
  records: HistoryRecord[];
}

const shortDate = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
const fullDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const trendModes = { eDpi: "eDPI", sensitivity: "游戏内灵敏度" } as const;
type TrendMode = keyof typeof trendModes;

export function HistoryChart({ records }: HistoryChartProps) {
  const [mode, setMode] = useState<TrendMode>("eDpi");
  const data = [...records]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(({ id, date, snapshot }) => {
      const { dpi } = snapshot.settings;
      const { sensitivity } = snapshot.recommendation;
      return { id, date: new Date(date), dpi, sensitivity, eDpi: Math.round(eDpi(dpi, sensitivity)) };
    });

  if (data.length === 0) {
    return null;
  }

  const points = new Map(data.map((point) => [point.id, point]));
  const latest = data[data.length - 1][mode];
  const formatValue = (value: number) => mode === "eDpi" ? value.toFixed(0) : value.toFixed(3);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="趋势指标" className="inline-flex rounded-lg border border-line bg-panel-2 p-1">
          {(Object.keys(trendModes) as TrendMode[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-accent ${
                mode === option ? "bg-accent/15 text-accent-2" : "text-dim hover:text-fg"
              }`}
              onClick={() => setMode(option)}
            >
              {trendModes[option]}
            </button>
          ))}
        </div>
        <p className="text-xs text-dim">
          {mode === "eDpi" ? "eDPI = DPI × 游戏内灵敏度，可对比不同 DPI 的记录。" : "显示每次推荐的游戏内设置值。"}
        </p>
      </div>
      <div className="h-64 w-full" role="group" aria-label={`${trendModes[mode]}趋势图`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -4 }}>
            <CartesianGrid stroke="#232b36" strokeDasharray="3 3" />
            <XAxis
              dataKey="id"
              stroke="#8b95a3"
              fontSize={11}
              tickLine={false}
              minTickGap={14}
              tickFormatter={(id: string) => {
                const point = points.get(id);
                return point ? shortDate.format(point.date) : "";
              }}
            />
            <YAxis
              stroke="#8b95a3"
              fontSize={11}
              tickLine={false}
              domain={["auto", "auto"]}
              allowDecimals={mode === "sensitivity"}
              tickFormatter={formatValue}
            />
            <Tooltip
              contentStyle={{
                background: "#10151c",
                border: "1px solid #232b36",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#8b95a3" }}
              labelFormatter={(id) => {
                const point = points.get(String(id));
                return point ? (
                  <span>
                    {fullDate.format(point.date)}
                    <br />
                    {point.dpi} DPI · 灵敏度 {point.sensitivity.toFixed(3)} · {point.eDpi} eDPI
                  </span>
                ) : null;
              }}
              formatter={(value) => [formatValue(Number(value)), trendModes[mode]]}
            />
            <ReferenceLine y={latest} stroke="#f43f4e" strokeDasharray="4 4" />
            <Line
              type="linear"
              dataKey={mode}
              stroke="#f43f4e"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#f43f4e", stroke: "#0b0f14", strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
