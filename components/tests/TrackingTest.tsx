"use client";

import { useRef } from "react";
import { useAim, type FrameData, type Scene } from "@/components/aim/AimArena";
import { computeTrackingScore } from "@/lib/scoring";
import { coveredTrackingMs, type TrackingScoringMethod } from "@/lib/tracking-metrics";
import type { ScenePlan } from "@/lib/test-plan";
import { TRACKING_RADIUS, configFor, mulberry32 } from "./shared";
import { useActiveTest } from "@/hooks/useActiveTest";
import type { TestMode, TrackingResult, TrackingSample } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface TrackingTestProps {
  mode: TestMode;
  plan?: ScenePlan;
  scoringMethod?: TrackingScoringMethod;
  eventCoverage?: boolean;
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
export function TrackingTest({ mode, onComplete, scoringMethod = "time", eventCoverage = true, plan }: TrackingTestProps) {
  const aim = useAim();
  const cfg = configFor(mode);
  const recordsCoverage = eventCoverage && scoringMethod === "time";
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const s = useRef({
    durationMs: cfg.trackingDurationMs,
    seed: plan?.seed ?? Math.floor(Math.random() * 1e9),
    params: null as TrackParams | null,
    samples: [] as TrackingSample[],
    startedAt: 0,
    lastCoverage: null as TrackingSample | null,
    coveredTimeMs: 0,
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
    return {
      x: plan && (plan.variant & 1) ? 2 * p.cx - x : x,
      y: plan && (plan.variant & 2) ? 2 * p.cy - y : y,
    };
  };

  const recordCoverage = (sample: TrackingSample) => {
    const previous = s.lastCoverage;
    if (previous) {
      if (sample.t < previous.t) return;
      s.coveredTimeMs += coveredTrackingMs(previous, sample, TRACKING_RADIUS);
    }
    s.lastCoverage = sample;
  };

  const onPointerMove = (cursorX: number, cursorY: number, time: number) => {
    if (!s.params || !s.lastCoverage || s.finished) return;
    const t = Math.min(s.durationMs, Math.max(s.lastCoverage.t, time - s.startedAt));
    const target = targetPos(s.params, t / 1000);
    recordCoverage({ t, cursorX, cursorY, targetX: target.x, targetY: target.y });
  };

  const finish = () => {
    if (s.finished) return;
    s.finished = true;
    const first = s.samples[0];
    // 目标经过静止准星也可能得分。至少移动四分之一目标半径，排除静止和微小抖动。
    const moved = first && s.samples.some((sample) =>
      Math.hypot(sample.cursorX - first.cursorX, sample.cursorY - first.cursorY) >= TRACKING_RADIUS / 4
    );
    if (!moved) {
      aim.pause("tracking-idle");
      return;
    }
    const result = computeTrackingScore({
      samples: s.samples,
      targetRadius: TRACKING_RADIUS,
      seed: s.seed,
      method: scoringMethod,
      coveredTimeMs: recordsCoverage ? s.coveredTimeMs : undefined,
    });
    onCompleteRef.current(result);
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    const previous = s.samples.at(-1);
    if (!previous) s.startedAt = f.now;
    // 第一帧只记录起点，然后按实际测量间隔推进。
    const elapsedMs = previous ? previous.t + f.dt : 0;
    if (scoringMethod === "frames" && elapsedMs >= s.durationMs) {
      finish();
      return;
    }
    const t = Math.min(elapsedMs, s.durationMs);
    const tSec = t / 1000;
    s.params ??= buildParams(f);
    const tp = targetPos(s.params, tSec);
    let cursorX = f.x;
    let cursorY = f.y;
    // 最后一帧可以越过时限，只计到边界。准星位置在相邻测量点之间插值。
    if (previous && elapsedMs > t) {
      const fraction = (t - previous.t) / f.dt;
      cursorX = previous.cursorX + (f.x - previous.cursorX) * fraction;
      cursorY = previous.cursorY + (f.y - previous.cursorY) * fraction;
    }
    const sample = { t, cursorX, cursorY, targetX: tp.x, targetY: tp.y };
    s.samples.push(sample);
    if (recordsCoverage) recordCoverage(sample);
    if (t >= s.durationMs) {
      finish();
      return;
    }

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

  const onReset = () => {
    // 跟踪是一个连续目标；暂停后重做本段，保留同一条轨迹。
    s.samples = [];
    s.params = null;
    s.lastCoverage = null;
    s.coveredTimeMs = 0;
    s.finished = false;
    aim.sceneRef.current.targets = [];
    aim.sceneRef.current.trail = [];
    aim.sceneRef.current.progress = undefined;
  };

  useActiveTest({ onFrame, onPointerMove: recordsCoverage ? onPointerMove : undefined, onReset });

  return null;
}
