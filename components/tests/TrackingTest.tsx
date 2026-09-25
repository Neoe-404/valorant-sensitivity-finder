"use client";

import { useEffect, useRef } from "react";
import { useAim, type ActiveTestApi, type FrameData, type Scene } from "@/components/aim/AimArena";
import { computeTrackingScore } from "@/lib/scoring";
import { TRACKING_RADIUS, configFor, dist, mulberry32 } from "./shared";
import type { TestMode, TrackingResult, TrackingSample } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface TrackingTestProps {
  mode: TestMode;
  onComplete: (result: TrackingResult) => void;
}

interface TrackParams {
  cx: number;
  cy: number;
  ax: number;
  bx: number;
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  ay: number;
  by: number;
  v1: number;
  v2: number;
  q1: number;
  q2: number;
  driftFreq: number;
  driftPhase: number;
}

/**
 * Tracking Test：
 * 目标沿“正弦叠加 + 漂移”的平滑曲线运动（速度时刻变化，但连续可预测）。
 * 逐帧记录 cursor-target 距离 / 覆盖 / 速度匹配 / 抖动。
 */
export function TrackingTest({ mode, onComplete }: TrackingTestProps) {
  const aim = useAim();
  const { registerActive } = aim;
  const cfg = configFor(mode);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const s = useRef({
    elapsedMs: 0,
    durationMs: cfg.trackingDurationMs,
    seed: Math.floor(Math.random() * 1e9),
    params: null as TrackParams | null,
    samples: [] as TrackingSample[],
    prevCursor: { x: 0, y: 0 },
    prevTarget: { x: 0, y: 0 },
    finished: false,
  }).current;

  const buildParams = (f: FrameData): TrackParams => {
    const rng = mulberry32(s.seed);
    const ra = (lo: number, hi: number) => lo + rng() * (hi - lo);
    const cx = f.w / 2;
    const cy = f.h * 0.5;
    const ax = f.w * ra(0.16, 0.26);
    const ay = f.h * ra(0.12, 0.2);
    const w1 = ra(0.6, 0.95); // rad/s 主频
    const w2 = w1 * ra(1.6, 2.4);
    const v1 = ra(0.5, 0.8);
    const v2 = v1 * ra(1.5, 2.2);
    return {
      cx,
      cy,
      ax,
      bx: ax * 0.4,
      w1,
      w2,
      p1: ra(0, Math.PI * 2),
      p2: ra(0, Math.PI * 2),
      ay,
      by: ay * 0.4,
      v1,
      v2,
      q1: ra(0, Math.PI * 2),
      q2: ra(0, Math.PI * 2),
      driftFreq: ra(0.09, 0.15),
      driftPhase: ra(0, Math.PI * 2),
    };
  };

  const targetPos = (p: TrackParams, t: number) => {
    const x =
      p.cx +
      p.ax * Math.sin(p.w1 * t + p.p1) +
      p.bx * Math.sin(p.w2 * t + p.p2) +
      p.ax * 0.08 * Math.sin(p.driftFreq * t + p.driftPhase);
    const y =
      p.cy +
      p.ay * Math.sin(p.v1 * t * 1.15 + p.q1) +
      p.by * Math.sin(p.v2 * t + p.q2) +
      p.ay * 0.08 * Math.cos(p.driftFreq * t * 0.8 + p.driftPhase);
    return { x, y };
  };

  const finish = () => {
    if (s.finished) return;
    s.finished = true;
    const result = computeTrackingScore({
      samples: s.samples,
      targetRadius: TRACKING_RADIUS,
      seed: s.seed,
    });
    onCompleteRef.current(result);
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    // 只有实际运行的帧累计时间，就绪和暂停不消耗测试时长。
    if (s.params) s.elapsedMs += f.dt;
    const tSec = s.elapsedMs / 1000;
    if (tSec >= s.durationMs / 1000) {
      finish();
      return;
    }
    if (!s.params) {
      s.params = buildParams(f);
      s.prevCursor = { x: f.x, y: f.y };
      s.prevTarget = targetPos(s.params, tSec);
    }
    const p = s.params;
    const tp = targetPos(p, tSec);
    const error = dist(f.x, f.y, tp.x, tp.y);

    const dtSec = f.dt / 1000;
    const cursorSpeed = dtSec > 0 ? dist(s.prevCursor.x, s.prevCursor.y, f.x, f.y) / dtSec : 0;
    const targetSpeed = dtSec > 0 ? dist(s.prevTarget.x, s.prevTarget.y, tp.x, tp.y) / dtSec : 0;

    // 跳过暂停等大间隔帧，避免污染速度统计
    if (f.dt < 300) {
      s.samples.push({
        t: s.elapsedMs,
        cursorX: f.x,
        cursorY: f.y,
        targetX: tp.x,
        targetY: tp.y,
        error,
        inside: error <= TRACKING_RADIUS,
        cursorSpeed,
        targetSpeed,
      });
    }

    s.prevCursor = { x: f.x, y: f.y };
    s.prevTarget = { x: tp.x, y: tp.y };

    const target: SceneTarget = {
      id: 9901,
      x: tp.x,
      y: tp.y,
      r: TRACKING_RADIUS,
      kind: "track",
      born: f.now,
    };
    scene.targets = [target];
    scene.trail.push({ x: f.x, y: f.y, t: f.now });
    if (scene.trail.length > 60) scene.trail.splice(0, scene.trail.length - 60);
    scene.progress = {
      done: Math.round(tSec * 10),
      total: Math.round(s.durationMs / 100),
      label: `${Math.round(tSec)}s / ${Math.round(s.durationMs / 1000)}s`,
    };
  };

  const onPointerDown = () => {
    // Tracking 无需点击
  };

  const onReset = () => {
    // 跟踪是一个连续目标；暂停后重做本段，保留同一条轨迹。
    s.elapsedMs = 0;
    s.samples = [];
    s.params = null;
    s.prevCursor = { x: 0, y: 0 };
    s.prevTarget = { x: 0, y: 0 };
    s.finished = false;
    aim.sceneRef.current.targets = [];
    aim.sceneRef.current.trail = [];
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
