"use client";

import { useEffect, useRef } from "react";
import { useAim, type ActiveTestApi, type FrameData, type Scene } from "@/components/aim/AimArena";
import { CAL_RADIUS, configFor, dist, mulberry32 } from "./shared";
import type { CalibrationResult, TestMode } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface CalibrationTestProps {
  mode: TestMode;
  onComplete: (result: CalibrationResult) => void;
}

/**
 * 校准：不计入正式成绩。
 * 建立基准：移动速度 / 活动范围 / 点击延迟基线。
 * 时长约 20 秒或完成 8 个目标。
 */
export function CalibrationTest({ mode, onComplete }: CalibrationTestProps) {
  const aim = useAim();
  const { registerActive } = aim;
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
    clicks: [] as number[],
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

  const maybeFinish = () => {
    // 20 秒上限
    if (s.elapsedMs >= 20000 || s.clicks.length >= s.total || s.finished) {
      if (s.finished) return;
      s.finished = true;
      const durationMs = s.elapsedMs;
      const totalDist = s.completedDistance + s.moveDist;
      const avgMoveSpeed = totalDist / Math.max(0.001, durationMs / 1000);
      const result: CalibrationResult = {
        durationMs,
        clicks: s.clicks.length,
        avgMoveSpeed,
        avgClickDelay: s.clickDelays.length ? s.clickDelays.reduce((a, b) => a + b, 0) / s.clickDelays.length : 0,
        avgReachDistance: s.reachDistances.length
          ? s.reachDistances.reduce((a, b) => a + b, 0) / s.reachDistances.length
          : 0,
        hitRate: s.clicks.length ? s.hits / s.clicks.length : 0,
        timestamp: Date.now(),
      };
      onCompleteRef.current(result);
    }
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    s.elapsedMs += f.dt;
    maybeFinish();
    if (s.finished) return;
    if (!s.target || !s.targetPos) {
      spawnTarget(f, scene);
      return;
    }
    // 累计移动距离（基准速度）
    const seg = dist(s.prevX, s.prevY, f.x, f.y);
    s.moveDist += seg;
    s.prevX = f.x;
    s.prevY = f.y;
    maybeFinish();
    scene.progress = {
      done: s.clicks.length,
      total: s.total,
      label: `${s.clicks.length} / ${s.total}`,
    };
  };

  const onPointerDown = (x: number, y: number, scene: Scene) => {
    if (s.finished || !s.target || !s.targetPos) return;
    const now = performance.now();
    s.clicks.push(now);
    const hit = dist(x, y, s.targetPos.x, s.targetPos.y) <= CAL_RADIUS;
    if (hit) s.hits++;
    s.clickDelays.push(now - s.spawnTime);
    s.reachDistances.push(dist(s.startX, s.startY, s.targetPos.x, s.targetPos.y));
    s.completedDistance += s.moveDist;
    s.moveDist = 0;
    s.target = null;
    s.targetPos = null;
    scene.targets = [];
    maybeFinish();
  };

  const onReset = () => {
    s.target = null;
    s.targetPos = null;
    s.moveDist = 0;
    if (aim.sceneRef.current) aim.sceneRef.current.targets = [];
  };

  const apiRef = useRef<ActiveTestApi>({ onFrame, onPointerDown, onReset });
  apiRef.current = { onFrame, onPointerDown, onReset };

  useEffect(() => {
    registerActive({
      onFrame: (f, scene) => apiRef.current.onFrame(f, scene),
      onPointerDown: (x, y, scene) => apiRef.current.onPointerDown(x, y, scene),
      onReset: () => apiRef.current.onReset?.(),
    });
    return () => registerActive(null);
  }, [registerActive]);

  return null;
}
