import { describe, expect, it } from "vitest";
import { arenaLayout, circleTouchesRect, isArenaPlayable, MIN_ARENA_HEIGHT, MIN_ARENA_WIDTH } from "../lib/arena-geometry";
import { matchedSpawnPoint, scenePlanFor } from "../lib/test-plan";

describe("arena dimensions", () => {
  it("accepts the minimum size and rejects smaller or unmeasurable arenas", () => {
    expect(isArenaPlayable(MIN_ARENA_WIDTH, MIN_ARENA_HEIGHT)).toBe(true);
    expect(isArenaPlayable(MIN_ARENA_WIDTH - 1, MIN_ARENA_HEIGHT)).toBe(false);
    expect(isArenaPlayable(MIN_ARENA_WIDTH, MIN_ARENA_HEIGHT - 1)).toBe(false);
    expect(isArenaPlayable(Number.POSITIVE_INFINITY, MIN_ARENA_HEIGHT)).toBe(false);
    expect(isArenaPlayable(MIN_ARENA_WIDTH, Number.NaN)).toBe(false);
  });

  it("centers the display after resizing without changing the session geometry or target distance", () => {
    const reference = { w: 960, h: 600 };
    const initial = arenaLayout(960, 600, reference);
    const resized = arenaLayout(960, 360, reference);
    expect(resized).toEqual({ w: 960, h: 600, scale: 0.6, displayWidth: 576, displayHeight: 360, left: 192, top: 0 });
    const firstTarget = ({ w, h }: typeof initial) => matchedSpawnPoint({
      w, h, fromX: w / 2, fromY: h / 2, targetRadius: 36, targetIndex: 0,
      kind: "flick", plan: scenePlanFor("same-session-geometry", 0),
    });
    expect(firstTarget(resized)).toEqual(firstTarget(initial));
    expect(arenaLayout(960, 360)).toEqual({ w: 960, h: 360, scale: 1, displayWidth: 960, displayHeight: 360, left: 0, top: 0 });
  });

  it("uses a playable logical area when settings capture a very small window", () => {
    const resized = arenaLayout(640, 480, { w: 200, h: 100 });
    expect(resized).toEqual({
      w: MIN_ARENA_WIDTH, h: MIN_ARENA_HEIGHT, scale: 2,
      displayWidth: 640, displayHeight: 360, left: 0, top: 60,
    });
  });
});

describe("arena overlay clearance", () => {
  const panel = { left: 10, top: 10, right: 50, bottom: 30 };

  it("detects a circle inside the panel and a circle touching the panel edge", () => {
    expect(circleTouchesRect(30, 20, 5, panel)).toBe(true);
    expect(circleTouchesRect(55, 20, 5, panel)).toBe(true);
  });

  it("tests the circle itself near a panel corner", () => {
    expect(circleTouchesRect(53, 34, 5, panel)).toBe(true);
    expect(circleTouchesRect(54, 34, 5, panel)).toBe(false);
  });
});

describe("matched target distances", () => {
  it.each([
    { w: 1920, h: 1080 },
    { w: 1036, h: 898 },
    { w: 640, h: 480 },
    { w: MIN_ARENA_WIDTH, h: MIN_ARENA_HEIGHT },
  ])("keeps the same distances at the center and all canvas edges in $w × $h", ({ w, h }) => {
    const starts = [
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h },
      { x: w / 2, y: h / 2 }, { x: 0, y: h / 2 }, { x: w / 2, y: 0 },
      { x: w / 2, y: h }, { x: w, y: h / 2 },
    ];
    for (const kind of ["flick", "micro"] as const) {
      const targetRadius = kind === "flick" ? 36 : 8;
      const targetEdge = targetRadius + 1;
      for (const session of ["session-a", "session-b", "session-c"]) {
        for (let targetIndex = 0; targetIndex < 20; targetIndex++) {
          const center = starts[4];
          const reference = matchedSpawnPoint({ w, h, fromX: center.x, fromY: center.y, kind, targetRadius,
            targetIndex, plan: scenePlanFor(session, 0) });
          const expectedDistance = Math.hypot(reference.x - center.x, reference.y - center.y);
          for (const start of starts) {
            for (let candidate = 0; candidate < 4; candidate++) {
              const point = matchedSpawnPoint({ w, h, fromX: start.x, fromY: start.y, kind, targetRadius,
                targetIndex, plan: scenePlanFor(session, candidate) });
              expect(Math.hypot(point.x - start.x, point.y - start.y)).toBeCloseTo(expectedDistance, 7);
              expect(point.x - targetEdge).toBeGreaterThanOrEqual(-1e-7);
              expect(point.x + targetEdge).toBeLessThanOrEqual(w + 1e-7);
              expect(point.y).toBeGreaterThanOrEqual(Math.max(targetEdge, Math.min(120, h * 0.2)) - 1e-7);
              expect(point.y + targetEdge).toBeLessThanOrEqual(h + 1e-7);
            }
          }
        }
      }
    }
  });

  it("reproduces the point when the current target is restarted", () => {
    const input = { w: 1920, h: 1080, fromX: 150, fromY: 280, targetRadius: 36, targetIndex: 7,
      kind: "flick" as const, plan: scenePlanFor("restartable-run", 2) };
    expect(matchedSpawnPoint(input)).toEqual(matchedSpawnPoint({ ...input, plan: scenePlanFor("restartable-run", 2) }));
    expect(matchedSpawnPoint({ ...input, plan: scenePlanFor("another-run", 2) })).not.toEqual(matchedSpawnPoint(input));
  });
});
