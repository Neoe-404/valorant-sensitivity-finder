"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePointerLock } from "@/hooks/usePointerLock";
import { useMouseTracking } from "@/hooks/useMouseTracking";
import { drawCrosshair, CROSSHAIR_DEFAULTS } from "./VirtualCrosshair";
import { drawTarget, type SceneTarget } from "./Target";

export type { SceneTarget } from "./Target";

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface Scene {
  targets: SceneTarget[];
  trail: TrailPoint[];
  /** 测试进度（HUD 轮询） */
  progress?: { done: number; total: number; label: string };
}

export interface FrameData {
  now: number;
  /** 本帧时间差 ms */
  dt: number;
  /** 虚拟准星位置（CSS px） */
  x: number;
  y: number;
  /** 本帧虚拟位移（已乘 SensitivityMultiplier） */
  dx: number;
  dy: number;
  /** 画布尺寸 CSS px */
  w: number;
  h: number;
  dpr: number;
  fps: number;
}

export interface ActiveTestApi {
  onFrame: (f: FrameData, scene: Scene) => void;
  onPointerDown: (x: number, y: number, scene: Scene) => void;
  /** 暂停恢复后丢弃当前目标的部分数据 */
  onReset?: () => void;
}

export type ArenaPhase = "idle" | "running" | "paused";

export interface AimContextValue {
  phase: ArenaPhase;
  locked: boolean;
  multiplier: number;
  crosshairColor: string;
  requestLockAndStart: () => void;
  resume: () => void;
  exit: () => void;
  registerActive: (api: ActiveTestApi | null) => void;
  getCursor: () => { x: number; y: number };
  readDebug: () => DebugInfo;
  lockedRef: React.MutableRefObject<boolean>;
  phaseRef: React.MutableRefObject<ArenaPhase>;
  sceneRef: React.MutableRefObject<Scene>;
  frameRef: React.MutableRefObject<FrameData>;
  pendingRef: React.MutableRefObject<{ dx: number; dy: number }>;
}

export interface DebugInfo {
  rawDx: number;
  rawDy: number;
  virtualX: number;
  virtualY: number;
  multiplier: number;
  fps: number;
  phase: ArenaPhase;
  w: number;
  h: number;
}

const AimContext = createContext<AimContextValue | null>(null);

export function useAim(): AimContextValue {
  const v = useContext(AimContext);
  if (!v) throw new Error("useAim must be used within <AimArena>");
  return v;
}

export interface AimArenaProps {
  multiplier: number;
  referenceWidth: number;
  crosshairColor?: string;
  /** 覆盖层（HUD、暂停、顶部信息等） */
  children?: React.ReactNode;
  onPhaseChange?: (phase: ArenaPhase) => void;
}

/**
 * 全屏测试区域：
 * - Pointer Lock 捕获真实鼠标增量 movementX/Y
 * - 虚拟准星位置 = 累积 (movementX/Y × multiplier)，存 ref，不经 React State
 * - 所有绘制走 Canvas + requestAnimationFrame，保证高帧率
 * - 窗口失焦 / 指针锁释放 → 自动暂停，避免记录无效数据
 */
export function AimArena({ multiplier, referenceWidth, crosshairColor, children, onPhaseChange }: AimArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { locked, lockedRef, rawInput, requestLock, exitLock } = usePointerLock(containerRef);
  const { pendingRef, handleMove, flush } = useMouseTracking();

  const [phase, setPhase] = useState<ArenaPhase>("idle");
  const phaseRef = useRef<ArenaPhase>("idle");
  const [lockError, setLockError] = useState(false);
  const startingRef = useRef(false);
  const setPhaseSafe = useCallback(
    (p: ArenaPhase) => {
      phaseRef.current = p;
      setPhase(p);
      onPhaseChange?.(p);
    },
    [onPhaseChange]
  );

  const cursorRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef<ActiveTestApi | null>(null);
  const sceneRef = useRef<Scene>({ targets: [], trail: [] });
  const frameRef = useRef<FrameData>({
    now: 0,
    dt: 16,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    w: 0,
    h: 0,
    dpr: 1,
    fps: 60,
  });
  const lastRawRef = useRef({ dx: 0, dy: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // 尺寸 & DPR
  useEffect(() => {
    const cv = canvasRef.current;
    const host = containerRef.current;
    if (!cv || !host) return;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      cv.style.width = `${rect.width}px`;
      cv.style.height = `${rect.height}px`;
      // 初始准星在屏幕中央
      if (cursorRef.current.x === 0 && cursorRef.current.y === 0) {
        cursorRef.current = { x: rect.width / 2, y: rect.height / 2 };
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // 失去指针锁后禁止采样。
  useEffect(() => {
    if (phaseRef.current === "running" && !locked) {
      setPhaseSafe("paused");
      activeRef.current?.onReset?.();
    }
  }, [locked, setPhaseSafe]);

  useEffect(() => {
    const onBlur = () => {
      if (phaseRef.current === "running") {
        setPhaseSafe("paused");
        activeRef.current?.onReset?.();
        exitLock();
      }
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
    };
  }, [setPhaseSafe, exitLock]);

  // 每当 phase / locked 变化，重新决定隐藏系统光标
  useEffect(() => {
    const host = containerRef.current;
    if (host) {
      host.style.cursor = phase === "running" && locked ? "none" : "default";
    }
  }, [phase, locked]);

  // 补充处理锁定已释放、事件尚未同步到 React 的 ESC 暂停。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current === "running" && !lockedRef.current) {
        setPhaseSafe("paused");
        activeRef.current?.onReset?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPhaseSafe, lockedRef]);

  // 鼠标事件
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (phaseRef.current !== "running" || !lockedRef.current) return;
      handleMove(e);
    };
    const onDown = (e: MouseEvent) => {
      if (phaseRef.current !== "running" || !lockedRef.current) return;
      if (e.button !== 0) return;
      const c = cursorRef.current;
      activeRef.current?.onPointerDown(c.x, c.y, sceneRef.current);
      e.preventDefault();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mousedown", onDown);
    };
  }, [handleMove, lockedRef]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, now: number, running: boolean) => {
      // 背景
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, w, h);
      // 网格
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const grid = 64;
      for (let gx = grid; gx < w; gx += grid) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
      }
      for (let gy = grid; gy < h; gy += grid) {
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
      }
      ctx.stroke();

      const scene = sceneRef.current;
      // 轨迹（渐隐）
      const trail = scene.trail;
      if (trail.length > 3) {
        ctx.lineCap = "round";
        ctx.lineWidth = 2;
        for (let i = 3; i < trail.length; i++) {
          const a = trail[i - 3];
          const b = trail[i - 1];
          const age = (now - b.t) / 1000;
          if (age > 0.6) continue;
          ctx.strokeStyle = `rgba(82,244,133,${0.28 * (1 - age / 0.6)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // 目标
      for (const t of scene.targets) {
        drawTarget(ctx, t, now);
      }

      // 准星（站在目标上的视觉层级）
      if (running) {
        drawCrosshair(ctx, cursorRef.current.x, cursorRef.current.y, {
          ...CROSSHAIR_DEFAULTS,
          color: crosshairColor || CROSSHAIR_DEFAULTS.color,
        });
      }
    },
    [crosshairColor]
  );

  // 主循环
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastT = performance.now();
    let fpsFrames = 0;
    let fpsT = performance.now();
    let fps = 60;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const now = t;
      const dt = Math.max(0, now - lastT);
      lastT = now;

      fpsFrames++;
      if (now - fpsT >= 1000) {
        fps = fpsFrames;
        fpsFrames = 0;
        fpsT = now;
      }

      const { w, h, dpr } = sizeRef.current;
      if (phaseRef.current === "running" && dt >= 300) {
        setPhaseSafe("paused");
        activeRef.current?.onReset?.();
        exitLock();
      }
      const running = phaseRef.current === "running" && lockedRef.current;

      if (running) {
        const raw = flush();
        const scale = multiplier * w / Math.max(1, referenceWidth);
        lastRawRef.current = { dx: raw.dx, dy: raw.dy };
        cursorRef.current.x = Math.max(0, Math.min(w, cursorRef.current.x + raw.dx * scale));
        cursorRef.current.y = Math.max(0, Math.min(h, cursorRef.current.y + raw.dy * scale));
        frameRef.current = {
          now,
          dt,
          x: cursorRef.current.x,
          y: cursorRef.current.y,
          dx: raw.dx * scale,
          dy: raw.dy * scale,
          w,
          h,
          dpr,
          fps,
        };
        activeRef.current?.onFrame(frameRef.current, sceneRef.current);
      }

      // 绘制
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, w, h, now, running);
      ctx.restore();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [multiplier, referenceWidth, draw, flush, lockedRef, setPhaseSafe, exitLock]);

  const requestLockAndStart = useCallback(() => {
    if (startingRef.current) return;
    startingRef.current = true;
    void (async () => {
      const ok = await requestLock();
      startingRef.current = false;
      if (!containerRef.current) return;
      if (ok) {
        // 锁定成功：清掉暂停期间可能残留的增量，避免恢复时准星跳跃
        pendingRef.current = { dx: 0, dy: 0 };
        setLockError(false);
        setPhaseSafe("running");
      } else {
        setLockError(true);
      }
    })();
  }, [requestLock, pendingRef, setPhaseSafe]);

  const resume = requestLockAndStart;

  const exit = useCallback(() => {
    exitLock();
    if (phaseRef.current === "running") {
      setPhaseSafe("paused");
      activeRef.current?.onReset?.();
    }
  }, [exitLock, setPhaseSafe]);

  const registerActive = useCallback((api: ActiveTestApi | null) => {
    activeRef.current = api;
    if (!api) {
      sceneRef.current = { targets: [], trail: [] };
    }
  }, []);

  const getCursor = useCallback(() => ({ ...cursorRef.current }), []);
  const readDebug = useCallback(
    () => ({
      rawDx: lastRawRef.current.dx,
      rawDy: lastRawRef.current.dy,
      virtualX: Math.round(cursorRef.current.x * 10) / 10,
      virtualY: Math.round(cursorRef.current.y * 10) / 10,
      multiplier: multiplier * sizeRef.current.w / Math.max(1, referenceWidth),
      fps: frameRef.current.fps,
      phase: phaseRef.current,
      w: sizeRef.current.w,
      h: sizeRef.current.h,
    }),
    [multiplier, referenceWidth]
  );

  const value = useMemo<AimContextValue>(
    () => ({
      phase,
      locked,
      multiplier,
      crosshairColor: crosshairColor || CROSSHAIR_DEFAULTS.color,
      requestLockAndStart,
      resume,
      exit,
      registerActive,
      getCursor,
      readDebug,
      lockedRef,
      phaseRef,
      sceneRef,
      frameRef,
      pendingRef,
    }),
    [phase, locked, multiplier, crosshairColor, requestLockAndStart, resume, exit, registerActive, getCursor, readDebug, lockedRef, pendingRef]
  );

  return (
    <AimContext.Provider value={value}>
      <div
        ref={containerRef}
        className="fixed inset-0 z-50 overflow-hidden bg-void select-none"
        style={{ touchAction: "none" }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {lockError || (locked && !rawInput) ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[80] flex justify-center">
            <div className="rounded-lg border border-warn/50 bg-black/80 px-4 py-2 text-xs text-warn shadow-xl">
              {lockError
                ? "指针锁定失败，测试尚未开始。请稍候点击开始或恢复重试，或使用支持鼠标锁定的桌面浏览器。"
                : "当前使用普通鼠标锁定，系统指针加速可能影响手感。"}
            </div>
          </div>
        ) : null}
        {children}
      </div>
    </AimContext.Provider>
  );
}
