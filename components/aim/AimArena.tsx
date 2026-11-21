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
import { inputEventTime, useMouseTracking } from "@/hooks/useMouseTracking";
import { arenaLayout, circleTouchesRect, isArenaPlayable } from "@/lib/arena-geometry";
import { drawCrosshair, CROSSHAIR_DEFAULTS } from "./VirtualCrosshair";
import { drawTarget, type SceneTarget } from "./Target";

export type { SceneTarget } from "./Target";

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** 命中/未命中反馈标记，绘制后约 0.25s 内淡出。 */
export interface HitMark {
  x: number;
  y: number;
  t: number;
  hit: boolean;
}

export interface Scene {
  targets: SceneTarget[];
  trail: TrailPoint[];
  /** 命中反馈标记（由测试组件写入，绘制层消费） */
  hitMarks?: HitMark[];
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
  onPointerMove?: (x: number, y: number, time: number) => void;
  onPointerDown?: (x: number, y: number, scene: Scene, time?: number) => void;
  /** 暂停恢复后丢弃当前目标的部分数据 */
  onReset?: () => void;
}

export type ArenaPhase = "idle" | "running" | "paused";
type ArenaPauseReason = "tracking-idle" | "calibration-idle";
type ArenaSize = "measuring" | "too-small" | "ready";

export interface AimContextValue {
  phase: ArenaPhase;
  arenaSize: ArenaSize;
  pauseReason: ArenaPauseReason | null;
  restartRequired: boolean;
  locked: boolean;
  multiplier: number;
  crosshairColor: string;
  requestLockAndStart: () => void;
  resume: () => void;
  pause: (reason?: ArenaPauseReason) => void;
  registerActive: (api: ActiveTestApi | null) => void;
  registerOverlay: React.RefCallback<HTMLDivElement>;
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
const MAX_FRAME_GAP_MS = 300;
const OVERLAY_REVEAL_DELAY_MS = 160;
const CROSSHAIR_CLEARANCE = CROSSHAIR_DEFAULTS.gap + CROSSHAIR_DEFAULTS.length + CROSSHAIR_DEFAULTS.thickness;

function moveCursor(cursor: { x: number; y: number }, dx: number, dy: number, w: number, h: number) {
  cursor.x = Math.max(0, Math.min(w, cursor.x + dx));
  cursor.y = Math.max(0, Math.min(h, cursor.y + dy));
}

export function useAim(): AimContextValue {
  const v = useContext(AimContext);
  if (!v) throw new Error("useAim must be used within <AimArena>");
  return v;
}

export interface AimArenaProps {
  multiplier: number;
  referenceWidth: number;
  /** 有高度时固定会话内的计分尺寸，并等比适配窗口。 */
  referenceHeight?: number;
  crosshairColor?: string;
  /** 覆盖层（HUD、暂停、顶部信息等） */
  children?: React.ReactNode;
  onPhaseChange?: (phase: ArenaPhase) => void;
  beforeStart?: () => boolean;
}

/**
 * 全屏测试区域：
 * - Pointer Lock 捕获真实鼠标增量 movementX/Y
 * - 虚拟准星位置 = 累积 (movementX/Y × multiplier)，存 ref，不经 React State
 * - 运行时用 requestAnimationFrame 采样和绘制，等待或暂停时按需绘制
 * - 窗口失焦 / 指针锁释放 → 自动暂停，避免记录无效数据
 */
export function AimArena({ multiplier, referenceWidth, referenceHeight, crosshairColor, children, onPhaseChange, beforeStart }: AimArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { locked, lockedRef, rawInput, requestLock, exitLock, ownsLock } = usePointerLock(containerRef);
  const { pendingRef, handleMove, flush } = useMouseTracking();

  const [phase, setPhase] = useState<ArenaPhase>("idle");
  const [arenaSize, setArenaSize] = useState<ArenaSize>("measuring");
  const [pauseReason, setPauseReason] = useState<ArenaPauseReason | null>(null);
  const phaseRef = useRef<ArenaPhase>("idle");
  const [lockError, setLockError] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const restartRequiredRef = useRef(false);
  const startingRef = useRef<symbol | null>(null);
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
  const sizeRef = useRef({ ...arenaLayout(0, 0), viewWidth: 0, viewHeight: 0, dpr: 1, pixelRatio: 0 });
  const measureSizeRef = useRef<(() => void) | null>(null);
  const paintStillRef = useRef<(() => void) | null>(null);
  const lastSampleAtRef = useRef<number | null>(null);
  const overlaysRef = useRef(new Map<HTMLDivElement, { bounds: DOMRectReadOnly; revealAt: number }>());

  const registerOverlay = useCallback<React.RefCallback<HTMLDivElement>>((element) => {
    if (!element) return;
    const overlay = { bounds: element.getBoundingClientRect(), revealAt: 0 };
    overlaysRef.current.set(element, overlay);
    // 缓存面板位置。采样帧直接比较几何数据，避免逐帧读取 DOM 布局。
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      overlay.bounds = element.getBoundingClientRect();
    }) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      overlaysRef.current.delete(element);
      element.style.removeProperty("visibility");
    };
  }, []);

  const advanceCursor = useCallback(() => {
    const { w, h } = sizeRef.current;
    const raw = flush();
    const scale = multiplier * w / Math.max(1, referenceWidth);
    const dx = raw.dx * scale;
    const dy = raw.dy * scale;
    lastRawRef.current = { dx: raw.dx, dy: raw.dy };
    const cursor = cursorRef.current;
    const onMove = activeRef.current?.onPointerMove;
    if (onMove && raw.samples) {
      for (const sample of raw.samples) {
        moveCursor(cursor, sample.dx * scale, sample.dy * scale, w, h);
        onMove(cursor.x, cursor.y, sample.time);
      }
    } else {
      moveCursor(cursor, dx, dy, w, h);
    }
    return { dx, dy };
  }, [flush, multiplier, referenceWidth]);

  const canSample = useCallback(() =>
    phaseRef.current === "running" && lockedRef.current && ownsLock(),
  [lockedRef, ownsLock]);

  const updateResolution = useCallback(() => {
    if ((window.devicePixelRatio || 1) === sizeRef.current.pixelRatio) return false;
    measureSizeRef.current?.();
    return true;
  }, []);

  const pause = useCallback((reason?: ArenaPauseReason) => {
    if (phaseRef.current !== "running") {
      if (startingRef.current !== null) {
        startingRef.current = null;
        exitLock();
      }
      return;
    }
    setPauseReason(reason ?? null);
    setPhaseSafe("paused");
    lastSampleAtRef.current = null;
    flush();
    activeRef.current?.onReset?.();
    sceneRef.current.trail = [];
    sceneRef.current.hitMarks = [];
    exitLock();
  }, [exitLock, flush, setPhaseSafe]);

  // 避免在同一项目里混用不同大小的画布或像素比例。
  useEffect(() => {
    const cv = canvasRef.current;
    const host = containerRef.current;
    if (!cv || !host) return;
    const resize = () => {
      const { width: viewWidth, height: viewHeight } = host.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const layout = arenaLayout(viewWidth, viewHeight, referenceHeight === undefined
        ? undefined
        : { w: referenceWidth, h: referenceHeight });
      const previous = sizeRef.current;
      if (previous.viewWidth === viewWidth && previous.viewHeight === viewHeight &&
        previous.pixelRatio === pixelRatio && previous.w === layout.w && previous.h === layout.h) return;

      const measured = previous.pixelRatio > 0;
      if (measured && startingRef.current !== null) pause();
      if (measured && phaseRef.current !== "idle" && !restartRequiredRef.current) {
        restartRequiredRef.current = true;
        setRestartRequired(true);
        setLockError(false);
        pause();
        sceneRef.current = { targets: [], trail: [] };
      }
      const dpr = Math.min(pixelRatio, 2);
      sizeRef.current = { ...layout, viewWidth, viewHeight, dpr, pixelRatio };
      setArenaSize(isArenaPlayable(viewWidth, viewHeight) ? "ready" : "too-small");
      cv.width = Math.round(layout.displayWidth * dpr);
      cv.height = Math.round(layout.displayHeight * dpr);
      cv.style.width = `${layout.displayWidth}px`;
      cv.style.height = `${layout.displayHeight}px`;
      cv.style.left = `${layout.left}px`;
      cv.style.top = `${layout.top}px`;
      cursorRef.current = { x: layout.w / 2, y: layout.h / 2 };
      for (const [element, overlay] of overlaysRef.current) {
        overlay.bounds = element.getBoundingClientRect();
      }
      if (phaseRef.current !== "running") paintStillRef.current?.();
    };

    const resolutionQuery = () => window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    let resolution = resolutionQuery();
    const onResolutionChange = () => {
      resolution.removeEventListener("change", onResolutionChange);
      resolution = resolutionQuery();
      resolution.addEventListener("change", onResolutionChange);
      resize();
    };

    measureSizeRef.current = resize;
    resize();
    resolution.addEventListener("change", onResolutionChange);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    window.addEventListener("resize", resize);
    window.addEventListener("focus", resize);
    return () => {
      measureSizeRef.current = null;
      window.removeEventListener("resize", resize);
      window.removeEventListener("focus", resize);
      resolution.removeEventListener("change", onResolutionChange);
      observer?.disconnect();
    };
  }, [pause, referenceWidth, referenceHeight]);

  // 失去指针锁后禁止采样。
  useEffect(() => {
    // 读取最新锁状态，避免载入时的旧渲染状态取消刚刚通过的请求。
    if (phaseRef.current === "running" && !lockedRef.current) pause();
  }, [locked, lockedRef, pause]);

  useEffect(() => {
    const onBlur = () => pause();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") pause();
    };
    const onVisibilityChange = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pause]);

  // 每当 phase / locked 变化，重新决定隐藏系统光标
  useEffect(() => {
    const host = containerRef.current;
    if (host) {
      host.style.cursor = phase === "running" && locked ? "none" : "default";
    }
  }, [phase, locked]);

  // 鼠标事件
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && canSample()) handleMove(e, activeRef.current?.onPointerMove !== undefined);
    };
    const onDown = (e: MouseEvent) => {
      const onClick = activeRef.current?.onPointerDown;
      if (e.button !== 0 || !onClick || !canSample() || updateResolution()) return;
      const lastSampleAt = lastSampleAtRef.current;
      if (lastSampleAt !== null && performance.now() - lastSampleAt >= MAX_FRAME_GAP_MS) {
        pause();
        return;
      }
      // 先应用本帧尚未绘制的位移，按点击时的准星位置判定。
      advanceCursor();
      const { x, y } = cursorRef.current;
      onClick(x, y, sceneRef.current, inputEventTime(e));
      e.preventDefault();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mousedown", onDown);
    };
  }, [advanceCursor, canSample, handleMove, pause, updateResolution]);

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

      if (!running) {
        if (phaseRef.current === "paused") {
          drawCrosshair(ctx, cursorRef.current.x, cursorRef.current.y, {
            ...CROSSHAIR_DEFAULTS,
            color: crosshairColor || CROSSHAIR_DEFAULTS.color,
            alpha: 0.4,
          });
        }
        return;
      }

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

      // 命中/未命中反馈（短暂扩散环 + 勾/叉）
      const marks = scene.hitMarks;
      if (marks && marks.length) {
        const LIFE = 0.28;
        for (let i = marks.length - 1; i >= 0; i--) {
          const m = marks[i];
          const age = (now - m.t) / 1000;
          if (age > LIFE) {
            marks.splice(i, 1);
            continue;
          }
          const p = age / LIFE; // 0→1
          const alpha = 1 - p;
          const radius = 14 + p * 22;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 2;
          ctx.strokeStyle = m.hit ? "#52f485" : "#f43f4e";
          ctx.beginPath();
          ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          // 中心符号
          ctx.beginPath();
          if (m.hit) {
            ctx.moveTo(m.x - 5, m.y);
            ctx.lineTo(m.x - 1, m.y + 4);
            ctx.lineTo(m.x + 6, m.y - 5);
          } else {
            ctx.moveTo(m.x - 4, m.y - 4);
            ctx.lineTo(m.x + 4, m.y + 4);
            ctx.moveTo(m.x + 4, m.y - 4);
            ctx.lineTo(m.x - 4, m.y + 4);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      drawCrosshair(ctx, cursorRef.current.x, cursorRef.current.y, {
        ...CROSSHAIR_DEFAULTS,
        color: crosshairColor || CROSSHAIR_DEFAULTS.color,
      });
    },
    [crosshairColor]
  );

  // 只有运行且仍持有指针锁时，才排下一帧。
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf: number | null = null;
    let fpsFrames = 0;
    let fpsT = performance.now();
    let fps = 60;

    const paint = (now: number, running: boolean) => {
      const { w, h, scale, left, top } = sizeRef.current;
      if (!w || !h || !cv.width || !cv.height) return;
      const cursor = cursorRef.current;
      const targets = sceneRef.current.targets;
      for (const [element, overlay] of overlaysRef.current) {
        const { bounds } = overlay;
        if (!running) {
          overlay.revealAt = 0;
        } else if (
          circleTouchesRect(left + cursor.x * scale, top + cursor.y * scale, CROSSHAIR_CLEARANCE * scale, bounds) ||
          targets.some(({ x, y, r }) => circleTouchesRect(left + x * scale, top + y * scale, (r + 2) * scale, bounds))
        ) {
          overlay.revealAt = now + OVERLAY_REVEAL_DELAY_MS;
        }
        const visibility = now < overlay.revealAt ? "hidden" : "";
        if (element.style.visibility !== visibility) element.style.visibility = visibility;
      }
      ctx.save();
      ctx.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
      draw(ctx, w, h, now, running);
      ctx.restore();
    };
    const paintStill = () => paint(performance.now(), false);
    paintStillRef.current = paintStill;

    const tick = (now: number) => {
      raf = null;
      const dt = Math.max(0, now - (lastSampleAtRef.current ?? now));
      if (!canSample() || dt >= MAX_FRAME_GAP_MS) {
        pause();
        return;
      }
      if (updateResolution()) return;

      fpsFrames++;
      if (now - fpsT >= 1000) {
        fps = fpsFrames;
        fpsFrames = 0;
        fpsT = now;
      }

      const { w, h, dpr } = sizeRef.current;
      lastSampleAtRef.current = now;
      const { dx, dy } = advanceCursor();
      frameRef.current = {
        now,
        dt,
        x: cursorRef.current.x,
        y: cursorRef.current.y,
        dx,
        dy,
        w,
        h,
        dpr,
        fps,
      };
      activeRef.current?.onFrame(frameRef.current, sceneRef.current);

      if (canSample()) {
        paint(now, true);
        raf = requestAnimationFrame(tick);
      }
    };

    if (phase === "running" && locked) raf = requestAnimationFrame(tick);
    else paintStill();
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      paintStillRef.current = null;
    };
  }, [advanceCursor, canSample, draw, locked, pause, phase, updateResolution]);

  const requestLockAndStart = useCallback(() => {
    const canStart = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      const { viewWidth, viewHeight, pixelRatio } = sizeRef.current;
      return !restartRequiredRef.current && rect?.width === viewWidth && rect.height === viewHeight &&
        pixelRatio === (window.devicePixelRatio || 1) && isArenaPlayable(viewWidth, viewHeight);
    };
    if (startingRef.current !== null) return;
    measureSizeRef.current?.();
    if (!canStart() || beforeStart?.() === false) return;
    const attempt = Symbol();
    startingRef.current = attempt;
    setLockError(false);
    void (async () => {
      const ok = await requestLock();
      if (startingRef.current !== attempt) return;
      startingRef.current = null;
      if (!canStart() || (ok && beforeStart?.() === false)) {
        if (ok) exitLock();
        return;
      }
      if (ok && ownsLock()) {
        // 锁定成功：清掉暂停期间可能残留的增量，避免恢复时准星跳跃
        flush();
        lastSampleAtRef.current = null;
        setLockError(false);
        setPauseReason(null);
        setPhaseSafe("running");
      } else {
        exitLock();
        setLockError(true);
      }
    })();
  }, [requestLock, flush, setPhaseSafe, exitLock, ownsLock, beforeStart]);

  const resume = requestLockAndStart;

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
      arenaSize,
      pauseReason,
      restartRequired,
      locked,
      multiplier,
      crosshairColor: crosshairColor || CROSSHAIR_DEFAULTS.color,
      requestLockAndStart,
      resume,
      pause,
      registerActive,
      registerOverlay,
      getCursor,
      readDebug,
      lockedRef,
      phaseRef,
      sceneRef,
      frameRef,
      pendingRef,
    }),
    [phase, arenaSize, pauseReason, restartRequired, locked, multiplier, crosshairColor, requestLockAndStart, resume, pause, registerActive, registerOverlay, getCursor, readDebug, lockedRef, pendingRef]
  );

  return (
    <AimContext.Provider value={value}>
      <div
        ref={containerRef}
        className="fixed inset-0 z-50 overflow-hidden bg-void select-none"
        style={{ touchAction: "none" }}
      >
        <canvas ref={canvasRef} className="absolute" aria-label="瞄准测试区域" />
        {lockError ? (
          <div className="pointer-events-none absolute inset-x-0 top-24 z-[80] flex justify-center px-4">
            <div className="max-w-md rounded-xl border border-warn/50 bg-black/85 px-5 py-4 text-center text-sm text-warn shadow-2xl backdrop-blur-sm">
              <div className="font-semibold">指针锁定失败，测试尚未开始</div>
              <p className="mt-1.5 text-xs leading-relaxed text-warn/90">
                若刚按过 Esc，浏览器会短暂限制重新锁定，请等待约 1 秒后再点击「开始」。
                也可换用支持鼠标锁定的桌面浏览器（Chrome / Edge / Firefox）后重试。
              </p>
            </div>
          </div>
        ) : locked && !rawInput ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[80] flex justify-center px-4">
            <div ref={registerOverlay} className="rounded-lg border border-warn/50 bg-black/80 px-4 py-2 text-center text-xs text-warn shadow-xl">
              当前使用普通鼠标锁定，系统指针加速可能影响手感与结果准确性。
            </div>
          </div>
        ) : null}
        {children}
      </div>
    </AimContext.Provider>
  );
}
