"use client";

import { useEffect, useRef } from "react";
import { useAim, type ActiveTestApi, type FrameData, type Scene } from "@/components/aim/AimArena";
import { computeMicroScore } from "@/lib/scoring";
import { MICRO_RADIUS, configFor, dist, mulberry32 } from "./shared";
import type { MicroResult, MicroTargetRecord, TestMode } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface MicroAdjustmentTestProps {
  mode: TestMode;
  onComplete: (result: MicroResult) => void;
}

/**
 * Micro Adjustment Test：
 * 小目标出现在准星附近；需要“进入半径并稳定 hold 一小段时间”才算命中，
 * 用于检测微调精度与稳定性（而非大范围 Flick）。
 */
export function MicroAdjustmentTest({ mode, onComplete }: MicroAdjustmentTestProps) {
  const aim = useAim();
  const { registerActive } = aim;
  const cfg = configFor(mode);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const s = useRef({
    rng: mulberry32(Math.floor(Math.random() * 1e9)),
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
    prevX: 0,
    prevY: 0,
    lastVx: 0,
    lastVy: 0,
    lastSpd: 0,
  }).current;

  const spawnTarget = (f: FrameData, s_: typeof s) => {
    const cur = aim.getCursor();
    // 距离中心 80–170px 的环带内随机（靠近准星，但避免出生在准星上）
    const angle = s_.rng() * Math.PI * 2;
    const radius = 90 + s_.rng() * 100;
    const x = f.w / 2 + Math.cos(angle) * radius;
    const y = f.h / 2 + Math.sin(angle) * radius;
    // 至少离当前准星 45px，否则重试
    let px = x;
    let py = y;
    if (dist(cur.x, cur.y, x, y) < 45) {
      const a2 = angle + Math.PI / 1.6;
      px = f.w / 2 + Math.cos(a2) * radius;
      py = f.h / 2 + Math.sin(a2) * radius;
    }
    const id = s_.idCounter++;
    const now = performance.now();
    s_.target = { id, x: px, y: py, r: MICRO_RADIUS, kind: "micro", born: now };
    s_.rec = {
      targetId: id,
      targetX: px,
      targetY: py,
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
    s_.holding = false;
    s_.holdCount = 0;
    s_.holdErrSum = 0;
    s_.holdMax = 0;
    s_.prevX = cur.x;
    s_.prevY = cur.y;
    s_.lastVx = 0;
    s_.lastVy = 0;
    s_.lastSpd = 0;
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    s.elapsedMs += f.dt;
    if (!s.target) {
      spawnTarget(f, s);
      if (s.target) scene.targets = [s.target];
      return;
    }
    const rec = s.rec!;
    const d = dist(f.x, f.y, s.target.x, s.target.y);

    // 方向修正计数（微调场景下的小反向）
    const vx = f.x - s.prevX;
    const vy = f.y - s.prevY;
    const spd = Math.hypot(vx, vy);
    if (spd > 1.2 && s.lastSpd > 1.2 && vx * s.lastVx + vy * s.lastVy < -spd * s.lastSpd * 0.3) {
      rec.corrections++;
    }
    s.prevX = f.x;
    s.prevY = f.y;
    s.lastVx = vx;
    s.lastVy = vy;
    s.lastSpd = spd;

    if (d <= MICRO_RADIUS) {
      if (!s.holding) {
        s.holding = true;
        s.holdStart = f.now;
        s.holdCount = 0;
        s.holdErrSum = 0;
        s.holdMax = 0;
      }
      s.holdCount++;
      s.holdErrSum += d;
      s.holdMax = Math.max(s.holdMax, d);
      if (f.now - s.holdStart >= s.holdMs) {
        hit(f);
        scene.targets = [];
        return;
      }
    } else if (s.holding) {
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

  const hit = (f: FrameData) => {
    const rec = s.rec!;
    rec.hitTime = f.now;
    rec.holdStartTime = rec.hitTime - s.holdMs;
    rec.avgHoldError = s.holdCount > 0 ? s.holdErrSum / s.holdCount : 0;
    rec.maxHoldError = s.holdMax;
    rec.holdMs = f.now - s.holdStart;
    rec.completionTime = f.now - rec.spawnTime;
    rec.corrections = Math.min(8, rec.corrections);
    s.records.push({ ...rec });
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

  const apiRef = useRef<ActiveTestApi>({ onFrame, onPointerDown: () => {}, onReset });
  apiRef.current = { onFrame, onPointerDown: () => {}, onReset };

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
