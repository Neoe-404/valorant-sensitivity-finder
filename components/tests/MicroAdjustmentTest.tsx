"use client";

import { useRef } from "react";
import { useAim, type FrameData, type Scene } from "@/components/aim/AimArena";
import { computeMicroScore } from "@/lib/scoring";
import { clamp } from "@/lib/statistics";
import { matchedSpawnPoint, type ScenePlan } from "@/lib/test-plan";
import { MICRO_RADIUS, configFor, dist, mulberry32 } from "./shared";
import { useActiveTest } from "@/hooks/useActiveTest";
import type { MicroResult, MicroTargetRecord, TestMode } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface MicroAdjustmentTestProps {
  mode: TestMode;
  plan?: ScenePlan;
  timeWeighted?: boolean;
  onComplete: (result: MicroResult) => void;
}

function randomMicroPosition(f: FrameData, cursor: { x: number; y: number }, rng: () => number) {
  const angle = rng() * Math.PI * 2;
  const radius = 90 + rng() * 100;
  const margin = Math.min(120, Math.max(50, Math.min(f.w, f.h) * 0.12));
  let x = clamp(cursor.x + Math.cos(angle) * radius, margin, f.w - margin);
  let y = clamp(cursor.y + Math.sin(angle) * radius, margin, f.h - margin);
  if (dist(cursor.x, cursor.y, x, y) < 45) {
    const alternateAngle = angle + Math.PI / 1.6;
    x = clamp(cursor.x + Math.cos(alternateAngle) * radius, margin, f.w - margin);
    y = clamp(cursor.y + Math.sin(alternateAngle) * radius, margin, f.h - margin);
  }
  return { x, y };
}

/**
 * Micro Adjustment Test：
 * 小目标出现在准星附近；需要“进入半径并稳定 hold 一小段时间”才算命中，
 * 用于检测微调精度与稳定性（而非大范围 Flick）。
 */
export function MicroAdjustmentTest({ mode, onComplete, plan, timeWeighted = true }: MicroAdjustmentTestProps) {
  const aim = useAim();
  const cfg = configFor(mode);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const s = useRef({
    rng: mulberry32(plan?.seed ?? Math.floor(Math.random() * 1e9)),
    total: cfg.microTargets,
    holdMs: cfg.microHoldMs,
    target: null as SceneTarget | null,
    rec: null as MicroTargetRecord | null,
    records: [] as MicroTargetRecord[],
    elapsedMs: 0,
    finished: false,
    idCounter: 1,
    // hold 状态
    holding: false,
    holdStart: 0,
    holdCount: 0,
    holdErrSum: 0,
    holdMax: 0,
    previousTime: 0,
    previousError: 0,
    prevX: 0,
    prevY: 0,
    lastVx: 0,
    lastVy: 0,
    lastSpd: 0,
  }).current;

  const spawnTarget = (f: FrameData) => {
    const cur = aim.getCursor();
    const position = plan ? matchedSpawnPoint({
      w: f.w, h: f.h, fromX: cur.x, fromY: cur.y,
      targetRadius: MICRO_RADIUS, targetIndex: s.records.length, kind: "micro", plan,
    }) : randomMicroPosition(f, cur, s.rng);
    const id = s.idCounter++;
    const now = timeWeighted ? f.now : performance.now();
    s.target = { id, ...position, r: MICRO_RADIUS, kind: "micro", born: now };
    s.rec = {
      targetId: id,
      targetX: position.x,
      targetY: position.y,
      targetRadius: MICRO_RADIUS,
      spawnTime: now,
      hitTime: 0,
      holdStartTime: 0,
      avgHoldError: 0,
      maxHoldError: 0,
      corrections: 0,
      holdMs: 0,
      completionTime: 0,
    };
    s.holding = false;
    s.previousTime = f.now;
    s.previousError = dist(cur.x, cur.y, position.x, position.y);
    s.prevX = cur.x;
    s.prevY = cur.y;
    s.lastVx = 0;
    s.lastVy = 0;
    s.lastSpd = 0;
  };

  const startHold = (time: number) => {
    s.holding = true;
    s.holdStart = time;
    s.holdCount = 0;
    s.holdErrSum = 0;
    s.holdMax = 0;
  };

  const sampleHoldByTime = (time: number, error: number): number | null => {
    const previousInside = s.previousError <= MICRO_RADIUS;
    const inside = error <= MICRO_RADIUS;
    if (!previousInside && !inside) return null;

    const dt = time - s.previousTime;
    // 相邻两帧之间线性估计误差，并把区间裁到目标边缘和保持时限。
    const boundaryTime = previousInside === inside
      ? time
      : s.previousTime + dt * (MICRO_RADIUS - s.previousError) / (error - s.previousError);
    const start = previousInside ? s.previousTime : boundaryTime;
    const startError = previousInside ? s.previousError : MICRO_RADIUS;
    if (!s.holding) startHold(start);
    const deadline = s.holdStart + s.holdMs;
    const end = Math.min(inside ? time : boundaryTime, deadline);
    if (end > start) {
      const endError = s.previousError + (error - s.previousError) * (end - s.previousTime) / dt;
      s.holdErrSum += (startError + endError) / 2 * (end - start);
      s.holdMax = Math.max(s.holdMax, startError, endError);
    }
    return end >= deadline ? deadline : null;
  };

  const sampleHoldByFrame = (time: number, error: number): number | null => {
    if (error > MICRO_RADIUS) return null;
    if (!s.holding) startHold(time);
    s.holdCount++;
    s.holdErrSum += error;
    s.holdMax = Math.max(s.holdMax, error);
    return time - s.holdStart >= s.holdMs ? time : null;
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    s.elapsedMs += f.dt;
    if (!s.target) {
      spawnTarget(f);
      if (s.target) scene.targets = [s.target];
      return;
    }
    const rec = s.rec!;
    const d = dist(f.x, f.y, s.target.x, s.target.y);
    const hitTime = timeWeighted ? sampleHoldByTime(f.now, d) : sampleHoldByFrame(f.now, d);

    // 方向修正计数（微调场景下的小反向）
    const motionFraction = hitTime !== null && hitTime < f.now
      ? (hitTime - s.previousTime) / (f.now - s.previousTime)
      : 1;
    const vx = (f.x - s.prevX) * motionFraction;
    const vy = (f.y - s.prevY) * motionFraction;
    const spd = Math.hypot(vx, vy);
    if (spd > 1.2 && s.lastSpd > 1.2 && vx * s.lastVx + vy * s.lastVy < -spd * s.lastSpd * 0.3) {
      rec.corrections++;
    }
    s.prevX = f.x;
    s.prevY = f.y;
    s.lastVx = vx;
    s.lastVy = vy;
    s.lastSpd = spd;

    s.previousTime = f.now;
    s.previousError = d;
    if (hitTime !== null) {
      hit(hitTime, f.now, scene);
      scene.targets = [];
      return;
    }
    if (d > MICRO_RADIUS && s.holding) {
      // 离开锁定半径 → 修正次数 +1，重新开始 hold
      s.holding = false;
      rec.corrections++;
    }

    scene.targets = [s.target];
    scene.trail.push({ x: f.x, y: f.y, t: f.now });
    if (scene.trail.length > 40) scene.trail.splice(0, scene.trail.length - 40);
    scene.progress = {
      done: s.records.length,
      total: s.total,
      label: `${s.records.length} / ${s.total}`,
    };
  };

  const hit = (hitTime: number, frameTime: number, scene: Scene) => {
    const rec = s.rec!;
    rec.hitTime = hitTime;
    rec.holdStartTime = s.holdStart;
    rec.holdMs = hitTime - s.holdStart;
    rec.avgHoldError = s.holdErrSum / (timeWeighted ? rec.holdMs : s.holdCount);
    rec.maxHoldError = s.holdMax;
    rec.completionTime = hitTime - rec.spawnTime;
    rec.corrections = Math.min(8, rec.corrections);
    s.records.push({ ...rec });
    // 命中反馈：目标处短暂淡出的绿色标记
    if (!scene.hitMarks) scene.hitMarks = [];
    scene.hitMarks.push({ x: rec.targetX, y: rec.targetY, t: frameTime, hit: true });
    s.target = null;
    s.rec = null;

    if (s.records.length >= s.total) {
      s.finished = true;
      const result = computeMicroScore({
        records: s.records,
        targetRadius: MICRO_RADIUS,
        durationMs: s.elapsedMs,
      });
      onCompleteRef.current(result);
    }
  };

  const onReset = () => {
    s.target = null;
    s.rec = null;
    s.holding = false;
    if (aim.sceneRef.current) aim.sceneRef.current.targets = [];
  };

  useActiveTest({ onFrame, onReset });

  return null;
}
