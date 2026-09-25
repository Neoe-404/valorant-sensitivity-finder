"use client";

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
import type { HistoryRecord } from "@/types";

interface HistoryChartProps {
  records: HistoryRecord[];
}

interface Point {
  label: string;
  sens: number;
}

export function HistoryChart({ records }: HistoryChartProps) {
  const data: Point[] = [...records]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((r) => ({
      label: new Date(r.date).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
      sens: r.recommendedSensitivity,
    }));

  if (data.length === 0) {
    return null;
  }

  const last = data[data.length - 1].sens;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -12 }}>
          <CartesianGrid stroke="#232b36" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="#8b95a3" fontSize={11} tickLine={false} />
          <YAxis
            stroke="#8b95a3"
            fontSize={11}
            tickLine={false}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{
              background: "#10151c",
              border: "1px solid #232b36",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#8b95a3" }}
            formatter={(value) => [Number(value).toFixed(3), "Sensitivity"]}
          />
          <ReferenceLine y={last} stroke="#f43f4e" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="sens"
            stroke="#f43f4e"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#f43f4e", stroke: "#0b0f14", strokeWidth: 2 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
