"use client";

import { useRef } from "react";
import { useAim, type FrameData, type Scene } from "@/components/aim/AimArena";
import { CAL_RADIUS, configFor, dist, mulberry32 } from "./shared";
import { useActiveTest } from "@/hooks/useActiveTest";
import type { CalibrationResult, TestMode } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface CalibrationTestProps {
  mode: TestMode;
  onComplete: (result: CalibrationResult) => void;
}

const CALIBRATION_LIMIT_MS = 20_000;

/**
 * 校准在 20 秒或达到模式规定的点击次数后结束，不计入正式得分。
 */
export function CalibrationTest({ mode, onComplete }: CalibrationTestProps) {
  const aim = useAim();
  const cfg = configFor(mode);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const s = useRef({
    rng: mulberry32(Math.floor(Math.random() * 1e9)),
    total: cfg.calTargets,
    target: null as SceneTarget | null,
    targetPos: null as { x: number; y: number } | null,
    spawnTime: 0,
    startX: 0,
    startY: 0,
    clickDelays: [] as number[],
    reachDistances: [] as number[],
    hits: 0,
    elapsedMs: 0,
    completedDistance: 0,
    idCounter: 1,
    moveDist: 0,
    prevX: 0,
    prevY: 0,
    finished: false,
  }).current;

  const spawnTarget = (f: FrameData, scene: Scene) => {
    const cur = aim.getCursor();
    const margin = Math.min(120, Math.max(50, Math.min(f.w, f.h) * 0.12));
    const pos = {
      x: margin + s.rng() * (f.w - 2 * margin),
      y: margin + s.rng() * (f.h - 2 * margin),
    };
    const id = s.idCounter++;
    const now = performance.now();
    s.target = { id, x: pos.x, y: pos.y, r: CAL_RADIUS, kind: "cal", born: now };
    s.targetPos = pos;
    s.spawnTime = now;
    s.startX = cur.x;
    s.startY = cur.y;
    s.moveDist = 0;
    s.prevX = cur.x;
    s.prevY = cur.y;
    scene.targets = [s.target];
  };

  const finish = () => {
    const clicks = s.clickDelays.length;
    if (clicks === 0) {
      s.elapsedMs = 0;
      aim.pause("calibration-idle");
      return;
    }

    s.finished = true;
    const totalClickDelay = s.clickDelays.reduce((sum, delay) => sum + delay, 0);
    onCompleteRef.current({
      durationMs: s.elapsedMs,
      clicks,
      // 未点击的目标与暂停前丢弃的目标不进入速度基线。
      avgMoveSpeed: (s.completedDistance * 1000) / Math.max(1, totalClickDelay),
      avgClickDelay: totalClickDelay / clicks,
      avgReachDistance: s.reachDistances.reduce((sum, distance) => sum + distance, 0) / clicks,
      hitRate: s.hits / clicks,
      timestamp: Date.now(),
    });
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    s.elapsedMs = Math.min(CALIBRATION_LIMIT_MS, s.elapsedMs + f.dt);
    if (s.elapsedMs === CALIBRATION_LIMIT_MS) {
      finish();
      return;
    }
    if (!s.target || !s.targetPos) {
      spawnTarget(f, scene);
      return;
    }
    // 累计移动距离（基准速度）
    const seg = dist(s.prevX, s.prevY, f.x, f.y);
    s.moveDist += seg;
    s.prevX = f.x;
    s.prevY = f.y;
    scene.progress = {
      done: s.clickDelays.length,
      total: s.total,
      label: `${s.clickDelays.length} / ${s.total}`,
    };
  };

  const onPointerDown = (x: number, y: number, scene: Scene) => {
    if (s.finished || !s.target || !s.targetPos) return;
    const now = performance.now();
    const hit = dist(x, y, s.targetPos.x, s.targetPos.y) <= CAL_RADIUS;
    if (hit) s.hits++;
    s.clickDelays.push(now - s.spawnTime);
    s.reachDistances.push(dist(s.startX, s.startY, s.targetPos.x, s.targetPos.y));
    s.completedDistance += s.moveDist + dist(s.prevX, s.prevY, x, y);
    s.moveDist = 0;
    s.target = null;
    s.targetPos = null;
    scene.targets = [];
    if (s.clickDelays.length >= s.total) finish();
  };

  const onReset = () => {
    s.target = null;
    s.targetPos = null;
    s.moveDist = 0;
    aim.sceneRef.current.targets = [];
    aim.sceneRef.current.progress = undefined;
  };

  useActiveTest({ onFrame, onPointerDown, onReset });

  return null;
}
