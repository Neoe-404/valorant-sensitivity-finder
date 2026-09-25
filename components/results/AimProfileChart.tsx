"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  PolarRadiusAxis,
} from "recharts";
import type { AimProfile } from "@/types";

interface AimProfileChartProps {
  profile: AimProfile;
}

export function AimProfileChart({ profile }: AimProfileChartProps) {
  const data = [
    { axis: "Flick", value: profile.flick },
    { axis: "Tracking", value: profile.tracking },
    { axis: "Micro", value: profile.micro },
    { axis: "Stability", value: profile.stability },
    { axis: "Speed", value: profile.speed },
    { axis: "Precision", value: profile.precision },
  ];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#232b36" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "#8b95a3", fontSize: 12 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#4b5563", fontSize: 10 }} tickCount={5} />
          <Radar
            name="Aim Profile"
            dataKey="value"
            stroke="#f43f4e"
            fill="#f43f4e"
            fillOpacity={0.22}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
