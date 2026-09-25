"use client";

import { useEffect, useRef } from "react";
import { useAim, type ActiveTestApi, type FrameData, type Scene } from "@/components/aim/AimArena";
import { computeFlickScore } from "@/lib/scoring";
import { FLICK_RADIUS, configFor, dist, randomSpawnPoint } from "./shared";
import type { FlickResult, FlickTargetRecord, TestMode } from "@/types";
import type { SceneTarget } from "@/components/aim/Target";

interface FlickTestProps {
  mode: TestMode;
  onComplete: (result: FlickResult) => void;
}

interface FlickState {
  rng: () => number;
  total: number;
  target: SceneTarget | null;
  rec: FlickTargetRecord | null;
  path: { x: number; y: number }[];
  records: FlickTargetRecord[];
  elapsedMs: number;
  finished: boolean;
  idCounter: number;
  // 每目标临时量
  moveDist: number;
  prevX: number;
  prevY: number;
  lastVx: number;
  lastVy: number;
  lastSpd: number;
  stallStart: number;
  entered: boolean;
  lastTargetPos: { x: number; y: number } | null;
}

/**
 * Flick Test：20 个随机目标，记录每个目标的
 * 起点/命中点/路径/总距离/理想距离/反应/修正/过冲/欠冲。
 */
export function FlickTest({ mode, onComplete }: FlickTestProps) {
  const aim = useAim();
  const { registerActive } = aim;
  const cfg = configFor(mode);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const s = useRef<FlickState>({
    rng: Math.random,
    total: cfg.flickTargets,
    target: null,
    rec: null,
    path: [],
    records: [],
    elapsedMs: 0,
    finished: false,
    idCounter: 1,
    moveDist: 0,
    prevX: 0,
    prevY: 0,
    lastVx: 0,
    lastVy: 0,
    lastSpd: 0,
    stallStart: 0,
    entered: false,
    lastTargetPos: null,
  }).current;

  const spawnTarget = (f: FrameData, scene: Scene) => {
    const cur = aim.getCursor();
    const pos = randomSpawnPoint({
      w: f.w,
      h: f.h,
      fromX: cur.x,
      fromY: cur.y,
      minFromCursor: Math.min(Math.max(f.w, f.h) * 0.25, 320),
      avoidX: s.lastTargetPos?.x,
      avoidY: s.lastTargetPos?.y,
      rng: s.rng,
    });
    const id = s.idCounter++;
    const now = performance.now();
    const target: SceneTarget = { id, x: pos.x, y: pos.y, r: FLICK_RADIUS, kind: "flick", born: now };
    s.target = target;
    s.rec = {
      targetId: id,
      targetX: pos.x,
      targetY: pos.y,
      targetRadius: FLICK_RADIUS,
      startX: cur.x,
      startY: cur.y,
      spawnTime: now,
      firstMoveTime: 0,
      hitTime: 0,
      hitX: 0,
      hitY: 0,
      hit: false,
      pathSampleCount: 0,
      totalMouseDistance: 0,
      idealDistance: dist(cur.x, cur.y, pos.x, pos.y),
      correctionCount: 0,
      overshoot: false,
      overshootDistance: 0,
      undershoot: false,
      reactionTime: 0,
      timeToTarget: 0,
    };
    s.moveDist = 0;
    s.path = [];
    s.prevX = cur.x;
    s.prevY = cur.y;
    s.lastVx = 0;
    s.lastVy = 0;
    s.lastSpd = 0;
    s.stallStart = 0;
    s.entered = false;
    s.lastTargetPos = { x: pos.x, y: pos.y };
    scene.targets = [target];
  };

  const onFrame = (f: FrameData, scene: Scene) => {
    if (s.finished) return;
    s.elapsedMs += f.dt;
    if (!s.target) {
      spawnTarget(f, scene);
      return;
    }
    const rec = s.rec!;
    const t = s.target;

    // 路径采样
    const seg = dist(s.prevX, s.prevY, f.x, f.y);
    s.moveDist += seg;
    if (s.path.length < 400) s.path.push({ x: f.x, y: f.y });

    // 反应时间：累计位移超过 12px 视为“开始移动”
    if (!rec.firstMoveTime && s.moveDist > 12) {
      rec.firstMoveTime = f.now;
    }

    // 速度 / 方向
    const vx = f.x - s.prevX;
    const vy = f.y - s.prevY;
    const spd = Math.hypot(vx, vy);

    // 修正计数：明显反向
    if (spd > 5 && s.lastSpd > 5 && vx * s.lastVx + vy * s.lastVy < -spd * s.lastSpd * 0.4) {
      rec.correctionCount++;
    }

    const dToT = dist(f.x, f.y, t.x, t.y);

    // 欠冲：明显停滞在目标半径之外 (>120ms)，之后需要再次移动
    if (spd < 0.05 && dToT > t.r * 1.4) {
      if (!s.stallStart) s.stallStart = f.now;
      if (f.now - s.stallStart > 120 && s.moveDist > rec.idealDistance * 0.35 && !rec.undershoot) {
        rec.undershoot = true;
        rec.correctionCount++;
      }
    } else {
      s.stallStart = 0;
    }

    // 过冲：进入目标半径后再次大幅远离
    if (dToT <= t.r) s.entered = true;
    if (s.entered && dToT > t.r * 1.6) {
      rec.overshoot = true;
      rec.overshootDistance = Math.max(rec.overshootDistance, dToT - t.r);
    }

    s.prevX = f.x;
    s.prevY = f.y;
    s.lastVx = vx;
    s.lastVy = vy;
    s.lastSpd = spd;

    scene.trail.push({ x: f.x, y: f.y, t: f.now });
    if (scene.trail.length > 100) scene.trail.splice(0, scene.trail.length - 100);
    scene.progress = {
      done: s.records.length,
      total: s.total,
      label: `${s.records.length} / ${s.total}`,
    };
  };

  const onPointerDown = (x: number, y: number, scene: Scene) => {
    const rec = s.rec;
    if (s.finished || !rec || !s.target) return;
    const d = dist(x, y, s.target.x, s.target.y);
    rec.hit = d <= s.target.r;
    rec.hitTime = performance.now();
    rec.hitX = x;
    rec.hitY = y;
    rec.pathSampleCount = s.path.length;
    rec.totalMouseDistance = s.moveDist;
    rec.reactionTime = rec.firstMoveTime ? rec.firstMoveTime - rec.spawnTime : 0;
    rec.timeToTarget = rec.hitTime - rec.spawnTime;
    rec.correctionCount = Math.min(8, rec.correctionCount);
    s.records.push({ ...rec });
    s.target = null;
    s.rec = null;
    scene.targets = [];

    if (s.records.length >= s.total) {
      s.finished = true;
      const result = computeFlickScore({
        records: s.records,
        targetRadius: FLICK_RADIUS,
        durationMs: s.elapsedMs,
      });
      onCompleteRef.current(result);
    }
  };

  const onReset = () => {
    // 暂停恢复：丢弃当前目标的未完成数据，重新生成
    s.target = null;
    s.rec = null;
    s.moveDist = 0;
    s.stallStart = 0;
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
    return () => {
      registerActive(null);
    };
  }, [registerActive]);

  return null;
}
