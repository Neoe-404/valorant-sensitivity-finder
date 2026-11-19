import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveTestApi, AimContextValue, FrameData, Scene } from "../components/aim/AimArena";
import type { CalibrationResult, FlickResult, MicroResult, TrackingResult } from "../types";

// Exercise the real Canvas callbacks with a deterministic clock and hook host.
// Browser input and React rendering are checked separately; these tests cover scene transitions.
type SceneAim = Pick<AimContextValue, "getCursor" | "registerActive" | "sceneRef" | "pause">;
const host = vi.hoisted(() => ({ aim: null as SceneAim | null }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => { effect(); },
}));
vi.mock("../components/aim/AimArena", () => ({ useAim: () => host.aim }));

import { TrackingTest } from "../components/tests/TrackingTest";
import { CalibrationTest } from "../components/tests/CalibrationTest";
import { MicroAdjustmentTest } from "../components/tests/MicroAdjustmentTest";
import { FlickTest } from "../components/tests/FlickTest";
import { drawTarget } from "../components/aim/Target";
import { scenePlanFor } from "../lib/test-plan";

let now: number;
let active: ActiveTestApi;
let scene: Scene;
let cursor: { x: number; y: number };
let pause: ReturnType<typeof vi.fn<SceneAim["pause"]>>;

beforeEach(() => {
  now = 100;
  cursor = { x: 960, y: 540 };
  scene = { targets: [], trail: [] };
  pause = vi.fn<SceneAim["pause"]>(() => active.onReset?.());
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  host.aim = {
    getCursor: () => cursor,
    registerActive: (api: ActiveTestApi | null) => { if (api) active = api; },
    sceneRef: { current: scene },
    pause,
  };
});
afterEach(() => vi.restoreAllMocks());

function frame(dt = 16, x = cursor.x, y = cursor.y) {
  now += dt;
  cursor = { x, y };
  const f: FrameData = { now, dt, x, y, dx: 0, dy: 0, w: 1920, h: 1080, dpr: 1, fps: 60 };
  active.onFrame(f, scene);
}

function click(x = cursor.x, y = cursor.y) {
  if (!active.onPointerDown) throw new Error("Scene does not accept clicks");
  cursor = { x, y };
  active.onPointerDown(x, y, scene);
}

describe("tracking timing", () => {
  it.each([0, 1])("asks to retry when the cursor only varies by %s px", (jitter) => {
    const complete = vi.fn<(result: TrackingResult) => void>();
    TrackingTest({ mode: "quick", onComplete: complete });
    frame();
    for (let i = 0; i < 150; i++) frame(100, 960 + (i % 2) * jitter, 540);
    expect(complete).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledExactlyOnceWith("tracking-idle");
    expect(scene.targets).toEqual([]);

    // The same scene can be retried with measured movement.
    frame(100, 960, 540);
    for (let i = 0; i < 150; i++) frame(100, 960 + i, 540);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].durationMs).toBe(15000);
  });

  it("mirrors the same trajectory without changing the movement speed for another candidate", () => {
    const positions = (candidate: number) => {
      TrackingTest({ mode: "quick", plan: scenePlanFor("matched-session", candidate), onComplete: vi.fn() });
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < 30; i++) {
        frame(100);
        points.push({ x: scene.targets[0].x, y: scene.targets[0].y });
      }
      return points;
    };
    const normal = positions(0);
    const mirrored = positions(1);
    const vertical = positions(2);
    for (let i = 0; i < normal.length; i++) {
      expect(normal[i].x + mirrored[i].x).toBeCloseTo(1920, 7);
      expect(normal[i].y).toBeCloseTo(mirrored[i].y, 7);
      expect(normal[i].x).toBeCloseTo(vertical[i].x, 7);
      expect(normal[i].y + vertical[i].y).toBeCloseTo(1080, 7);
    }
    active.onReset?.();
    frame(100);
    expect(scene.targets[0].x).toBeCloseTo(vertical[0].x, 7);
    expect(scene.targets[0].y).toBeCloseTo(vertical[0].y, 7);
  });

  it("starts on the first running frame, not when the ready screen mounts", () => {
    const complete = vi.fn<(result: TrackingResult) => void>();
    TrackingTest({ mode: "standard", onComplete: complete });
    now += 60000;
    frame();
    expect(complete).not.toHaveBeenCalled();
    for (let i = 0; i < 1250; i++) frame(16, 960 + (i % 200), 540);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].sampleCount).toBeGreaterThan(1200);
    expect(complete.mock.calls[0][0].durationMs).toBe(20000);
    frame();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("restarts the tracking segment after pause without retaining old samples", () => {
    const complete = vi.fn<(result: TrackingResult) => void>();
    TrackingTest({ mode: "quick", onComplete: complete });
    for (let i = 0; i < 300; i++) frame();
    active.onReset?.();
    now += 60000;
    frame();
    expect(complete).not.toHaveBeenCalled();
    for (let i = 0; i < 938; i++) frame(16, 960 + (i % 200), 540);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].sampleCount).toBeLessThan(950);
    expect(complete.mock.calls[0][0].durationMs).toBe(15000);
  });
});

describe("calibration", () => {
  it("includes movement between the last frame and each click", () => {
    const complete = vi.fn<(result: CalibrationResult) => void>();
    CalibrationTest({ mode: "quick", onComplete: complete });
    now += 60000;
    for (let i = 0; i < 6; i++) {
      frame(16, 960, 540);
      frame(16, 1060, 540);
      click(1080, 540);
    }
    expect(complete).toHaveBeenCalledTimes(1);
    const result = complete.mock.calls[0][0];
    expect(result.clicks).toBe(6);
    expect(result.durationMs).toBe(192);
    expect(result.avgMoveSpeed * result.durationMs / 1000).toBeCloseTo(720, 5);
    frame();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not count paused wall-clock time toward the limit", () => {
    const complete = vi.fn<(result: CalibrationResult) => void>();
    CalibrationTest({ mode: "quick", onComplete: complete });
    frame();
    active.onReset?.();
    now += 60000;
    frame();
    expect(complete).not.toHaveBeenCalled();
    expect(scene.targets).toHaveLength(1);
  });
});

describe("micro target completion", () => {
  it("measures the same hold error at different sampling rates and excludes movement after the deadline", () => {
    const measure = (intervals: number[]) => {
      const complete = vi.fn<(result: MicroResult) => void>();
      MicroAdjustmentTest({ mode: "quick", onComplete: complete });
      for (let i = 0; i < 8; i++) {
        frame();
        const target = scene.targets[0];
        frame(16, target.x + 8, target.y);
        let elapsed = 0;
        for (const dt of intervals) {
          elapsed += dt;
          const error = elapsed <= 125 ? 8 - 4 * elapsed / 125 : 4 - 2 * (elapsed - 125) / 125;
          frame(dt, target.x + error, target.y);
        }
      }
      expect(complete).toHaveBeenCalledTimes(1);
      return complete.mock.calls[0][0];
    };
    const denseStart = measure([25, 25, 25, 25, 25, 135]);
    const denseEnd = measure([125, 25, 25, 25, 25, 35]);
    expect(denseStart.avgHoldError).toBeCloseTo(4.5, 7);
    expect(denseEnd.avgHoldError).toBeCloseTo(denseStart.avgHoldError, 7);
    expect(denseEnd.score).toBeCloseTo(denseStart.score, 7);
    expect(denseEnd.records[0].holdMs).toBeCloseTo(250, 7);
    expect(denseEnd.records[0].completionTime).toBeCloseTo(266, 7);
  });

  it("recognizes a completed hold before an exit measured by the next frame", () => {
    MicroAdjustmentTest({ mode: "quick", onComplete: vi.fn() });
    frame();
    const target = scene.targets[0];
    frame(16, target.x + 8, target.y);
    frame(240, target.x + 4, target.y);
    frame(40, target.x + 12, target.y);
    expect(scene.targets).toEqual([]);
    expect(scene.hitMarks).toHaveLength(1);
  });

  it("restarts the hold if the cursor leaves before the deadline", () => {
    MicroAdjustmentTest({ mode: "quick", onComplete: vi.fn() });
    frame();
    const target = scene.targets[0];
    frame(16, target.x + 8, target.y);
    frame(200, target.x + 4, target.y);
    frame(20, target.x + 12, target.y);
    frame(20, target.x + 8, target.y);
    frame(249, target.x + 8, target.y);
    expect(scene.hitMarks).toBeUndefined();
    frame(1, target.x + 8, target.y);
    expect(scene.hitMarks).toHaveLength(1);
  });

  it("keeps the planned distance after pausing and for the next candidate at an edge", () => {
    const plan = scenePlanFor("matched-micro", 0);
    MicroAdjustmentTest({ mode: "quick", plan, onComplete: vi.fn() });
    frame();
    const first = { ...scene.targets[0] };
    const distance = Math.hypot(first.x - cursor.x, first.y - cursor.y);
    active.onReset?.();
    frame();
    expect(scene.targets[0].x).toBe(first.x);
    expect(scene.targets[0].y).toBe(first.y);

    cursor = { x: 0, y: 1080 };
    MicroAdjustmentTest({ mode: "quick", plan: scenePlanFor("matched-micro", 1), onComplete: vi.fn() });
    frame();
    const next = scene.targets[0];
    expect(Math.hypot(next.x - cursor.x, next.y - cursor.y)).toBeCloseTo(distance, 7);
  });

  it.each([true, false])("completes only once and clears the scene with timeWeighted=%s", (timeWeighted) => {
    const complete = vi.fn<(result: MicroResult) => void>();
    MicroAdjustmentTest({ mode: "quick", timeWeighted, onComplete: complete });
    for (let i = 0; i < 8; i++) {
      frame();
      expect(scene.targets).toHaveLength(1);
      const target = scene.targets[0];
      frame(16, target.x, target.y);
      frame(251, target.x, target.y);
      expect(scene.targets).toEqual([]);
      expect(() => scene.targets.forEach((t) => drawTarget({} as CanvasRenderingContext2D, t, now))).not.toThrow();
    }
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].hits).toBe(8);
    const first = complete.mock.calls[0][0].records[0];
    expect(first.holdMs).toBeCloseTo(timeWeighted ? 250 : 251, 7);
    frame();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(scene.targets).toEqual([]);
  });

  it("spawns around the cursor and clamps the target inside the canvas", () => {
    const complete = vi.fn<(result: MicroResult) => void>();
    MicroAdjustmentTest({ mode: "quick", onComplete: complete });
    // 准星贴近画布左上角：目标仍应落在边距内，且距准星 ≥45px
    cursor = { x: 60, y: 60 };
    frame();
    expect(scene.targets).toHaveLength(1);
    const t = scene.targets[0];
    const margin = 120;
    expect(t.x).toBeGreaterThanOrEqual(margin);
    expect(t.x).toBeLessThanOrEqual(1920 - margin);
    expect(t.y).toBeGreaterThanOrEqual(margin);
    expect(t.y).toBeLessThanOrEqual(1080 - margin);
    expect(Math.hypot(t.x - cursor.x, t.y - cursor.y)).toBeGreaterThanOrEqual(45);
  });
});

describe("flick target completion", () => {
  it("keeps the planned target distance when another candidate begins from a corner", () => {
    FlickTest({ mode: "quick", plan: scenePlanFor("matched-flick", 0), onComplete: vi.fn() });
    frame();
    const first = { ...scene.targets[0] };
    const distance = Math.hypot(first.x - cursor.x, first.y - cursor.y);
    active.onReset?.();
    frame();
    expect(scene.targets[0].x).toBe(first.x);
    expect(scene.targets[0].y).toBe(first.y);

    cursor = { x: 1920, y: 0 };
    FlickTest({ mode: "quick", plan: scenePlanFor("matched-flick", 1), onComplete: vi.fn() });
    frame();
    const next = scene.targets[0];
    expect(Math.hypot(next.x - cursor.x, next.y - cursor.y)).toBeCloseTo(distance, 7);
  });

  it("records movement and hits when clicks arrive before the next frame", () => {
    vi.mocked(Math.random).mockReturnValue(0.25);
    const complete = vi.fn<(result: FlickResult) => void>();
    FlickTest({ mode: "quick", onComplete: complete }); // 12 targets
    for (let i = 0; i < 12; i++) {
      frame(); // 生成目标
      const t = scene.targets[0];
      expect(t).toBeDefined();
      // 命中反馈标记应被写入场景，由绘制层消费
      now += 25;
      click(t.x, t.y);
      expect(scene.hitMarks).toHaveLength(1);
      expect(scene.hitMarks![0].hit).toBe(true);
      scene.hitMarks = [];
    }
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].hits).toBe(12);
    expect(complete.mock.calls[0][0].misses).toBe(0);
    const first = complete.mock.calls[0][0].records[0];
    expect(first.idealDistance).toBeGreaterThan(320);
    expect(first.totalMouseDistance).toBeCloseTo(first.idealDistance, 5);
    expect(first.reactionTime).toBe(25);
    frame();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("records a miss when clicking outside the target radius", () => {
    const complete = vi.fn<(result: FlickResult) => void>();
    FlickTest({ mode: "quick", onComplete: complete });
    frame();
    const t = scene.targets[0];
    // 点击目标外 200px（远超半径 36）
    click(t.x + 200, t.y);
    expect(scene.hitMarks![0].hit).toBe(false);
    // 首个目标未命中 → 记录 1 miss，尚未完成（共 12 个）
    expect(complete).not.toHaveBeenCalled();
  });
});
