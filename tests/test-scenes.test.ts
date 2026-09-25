import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveTestApi, AimContextValue, FrameData, Scene } from "../components/aim/AimArena";
import type { CalibrationResult, MicroResult, TrackingResult } from "../types";

// Exercise the real Canvas callbacks with a deterministic clock and hook host.
// Browser input and React rendering are checked separately; these tests cover scene transitions.
const host = vi.hoisted(() => ({ aim: null as AimContextValue | null }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => { effect(); },
}));
vi.mock("../components/aim/AimArena", () => ({ useAim: () => host.aim }));

import { TrackingTest } from "../components/tests/TrackingTest";
import { CalibrationTest } from "../components/tests/CalibrationTest";
import { MicroAdjustmentTest } from "../components/tests/MicroAdjustmentTest";
import { drawTarget } from "../components/aim/Target";

let now: number;
let active: ActiveTestApi;
let scene: Scene;
let cursor: { x: number; y: number };

beforeEach(() => {
  now = 100;
  cursor = { x: 960, y: 540 };
  scene = { targets: [], trail: [] };
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  host.aim = {
    getCursor: () => cursor,
    registerActive: (api: ActiveTestApi | null) => { if (api) active = api; },
    sceneRef: { current: scene },
  } as AimContextValue;
});
afterEach(() => vi.restoreAllMocks());

function frame(dt = 16, x = cursor.x, y = cursor.y) {
  now += dt;
  cursor = { x, y };
  const f: FrameData = { now, dt, x, y, dx: 0, dy: 0, w: 1920, h: 1080, dpr: 1, fps: 60 };
  active.onFrame(f, scene);
}

describe("tracking timing", () => {
  it("starts on the first running frame, not when the ready screen mounts", () => {
    const complete = vi.fn<(result: TrackingResult) => void>();
    TrackingTest({ mode: "standard", onComplete: complete });
    now += 60000;
    frame();
    expect(complete).not.toHaveBeenCalled();
    for (let i = 0; i < 1250; i++) frame();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].sampleCount).toBeGreaterThan(1200);
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
    for (let i = 0; i < 938; i++) frame();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].sampleCount).toBeLessThan(950);
    expect(complete.mock.calls[0][0].durationMs).toBeLessThanOrEqual(15000);
  });
});

describe("calibration", () => {
  it("accumulates all movement and finishes on the final click", () => {
    const complete = vi.fn<(result: CalibrationResult) => void>();
    CalibrationTest({ mode: "quick", onComplete: complete });
    now += 60000;
    for (let i = 0; i < 6; i++) {
      frame(16, 960, 540);
      frame(16, 1060, 540);
      active.onPointerDown(cursor.x, cursor.y, scene);
    }
    expect(complete).toHaveBeenCalledTimes(1);
    const result = complete.mock.calls[0][0];
    expect(result.clicks).toBe(6);
    expect(result.durationMs).toBe(192);
    expect(result.avgMoveSpeed * result.durationMs / 1000).toBeCloseTo(600, 5);
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
  it("never sends null targets to the renderer and completes only once", () => {
    const complete = vi.fn<(result: MicroResult) => void>();
    MicroAdjustmentTest({ mode: "quick", onComplete: complete });
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
    frame();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(scene.targets).toEqual([]);
  });
});
