import { describe, expect, it } from "vitest";
import { matchedSpawnPoint, scenePlanFor } from "../lib/test-plan";

describe("matched target distances", () => {
  it.each([
    { w: 1920, h: 1080 },
    { w: 1036, h: 898 },
    { w: 640, h: 480 },
    { w: 320, h: 180 },
  ])("keeps the same distances at the center and all canvas edges in $w × $h", ({ w, h }) => {
    const starts = [
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h },
      { x: w / 2, y: h / 2 }, { x: 0, y: h / 2 }, { x: w / 2, y: 0 },
      { x: w / 2, y: h }, { x: w, y: h / 2 },
    ];
    for (const kind of ["flick", "micro"] as const) {
      const targetRadius = kind === "flick" ? 36 : 8;
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
              expect(point.x - targetRadius).toBeGreaterThanOrEqual(-1e-7);
              expect(point.x + targetRadius).toBeLessThanOrEqual(w + 1e-7);
              expect(point.y).toBeGreaterThanOrEqual(Math.min(120, h * 0.2) - 1e-7);
              expect(point.y + targetRadius).toBeLessThanOrEqual(h + 1e-7);
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
