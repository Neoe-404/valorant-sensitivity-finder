"use client";

import { useEffect, useState } from "react";
import { useAim } from "@/components/aim/AimArena";

/**
 * 开发调试面板：?debug=true 开启。
 * 显示原始/虚拟鼠标增量、虚拟坐标、倍率、FPS 等。
 */
export function DebugPanel() {
  const aim = useAim();
  const [enabled, setEnabled] = useState(false);
  const [d, setD] = useState(aim.readDebug());

  useEffect(() => {
    if (typeof window !== "undefined") {
      setEnabled(new URLSearchParams(window.location.search).get("debug") === "true");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setD(aim.readDebug()), 200);
    return () => window.clearInterval(id);
  }, [enabled, aim]);

  if (!enabled) return null;

  const rows: [string, string][] = [
    ["movementX", String(d.rawDx)],
    ["movementY", String(d.rawDy)],
    ["virtualX", d.virtualX.toFixed(1)],
    ["virtualY", d.virtualY.toFixed(1)],
    ["Scale", `${d.multiplier.toFixed(4)} px/cnt`],
    ["FPS", String(d.fps)],
    ["Phase", d.phase],
    ["Canvas", `${Math.round(d.w)}×${Math.round(d.h)}`],
  ];

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-[70] w-52 rounded-lg border border-line bg-black/80 p-3 font-mono text-[11px] text-green-400 shadow-2xl">
      <div className="mb-2 border-b border-line pb-1 text-[10px] uppercase tracking-widest text-dim">
        Debug
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 py-0.5">
          <span className="text-dim">{k}</span>
          <span className="text-right text-green-300">{v}</span>
        </div>
      ))}
    </div>
  );
}
