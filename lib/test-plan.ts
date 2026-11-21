export interface ScenePlan {
  seed: number;
  variant: number;
}

/** 每次会话生成一套方案，同一会话中的候选共享难度。 */
export function scenePlanFor(id: string, candidateIndex: number): ScenePlan {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return { seed: seed >>> 0, variant: candidateIndex % 4 };
}

/** 可复现伪随机数生成器（mulberry32）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MatchedSpawnOptions {
  w: number;
  h: number;
  fromX: number;
  fromY: number;
  targetRadius: number;
  targetIndex: number;
  kind: "flick" | "micro";
  plan: ScenePlan;
}

/** 同尺寸画布下，各候选按相同距离组合测试；边缘只改变方向。 */
export function matchedSpawnPoint(options: MatchedSpawnOptions): { x: number; y: number } {
  const { w, h, fromX, fromY, targetRadius, targetIndex, kind, plan } = options;
  // 内边距至少容纳完整目标和圆环描边。
  const targetEdge = targetRadius + 1;
  const insetX = Math.min(targetRadius + 16, w * 0.2);
  const insetBottom = Math.min(targetRadius + 16, Math.max(targetEdge, h * 0.2));
  const top = Math.max(targetEdge, Math.min(120, h * 0.2));
  const left = insetX;
  const right = w - insetX;
  const bottom = h - insetBottom;
  // 距离必须覆盖任意准星位置到目标区域的最近距离，并能从区域中心到达边缘。
  const nearestCornerDistance = Math.hypot(insetX, Math.max(top, insetBottom));
  const maxDistance = Math.hypot((right - left) / 2, (bottom - top) / 2) * 0.95;
  const desiredMin = kind === "flick" ? Math.min(320, Math.min(w, h) * 0.3) : 90;
  const desiredMax = kind === "flick" ? Math.min(480, Math.min(w, h) * 0.45) : 190;
  const minimum = Math.min(maxDistance, Math.max(desiredMin, nearestCornerDistance + 1));
  const maximum = Math.max(minimum, Math.min(desiredMax, maxDistance));

  // 每四个目标覆盖四档距离，候选之间使用相同次序。
  const block = targetIndex - targetIndex % 4;
  const distanceRng = mulberry32(plan.seed ^ Math.imul(block + 1, 0x9e3779b1) ^ (kind === "flick" ? 1 : 2));
  const levels = [0, 1 / 3, 2 / 3, 1];
  for (let i = levels.length - 1; i > 0; i--) {
    const j = Math.floor(distanceRng() * (i + 1));
    [levels[i], levels[j]] = [levels[j], levels[i]];
  }
  const distance = minimum + (maximum - minimum) * levels[targetIndex % 4];
  const directionRng = mulberry32(plan.seed ^ Math.imul(targetIndex + 1, 0x85ebca6b) ^ Math.imul(plan.variant + 1, 0xc2b2ae35));

  // 将等距圆按与矩形边缘的交点分段，只从可见的圆弧中选方向。
  const tau = Math.PI * 2;
  const angles = [0, tau];
  for (const x of [left, right]) {
    const cosine = (x - fromX) / distance;
    if (Math.abs(cosine) > 1) continue;
    const angle = Math.acos(cosine);
    angles.push(angle, tau - angle);
  }
  for (const y of [top, bottom]) {
    const sine = (y - fromY) / distance;
    if (Math.abs(sine) > 1) continue;
    const angle = Math.asin(sine);
    angles.push((angle + tau) % tau, (Math.PI - angle + tau) % tau);
  }
  angles.sort((a, b) => a - b);
  const arcs: { start: number; length: number }[] = [];
  for (let i = 1; i < angles.length; i++) {
    const start = angles[i - 1];
    const end = angles[i];
    const middle = (start + end) / 2;
    const x = fromX + Math.cos(middle) * distance;
    const y = fromY + Math.sin(middle) * distance;
    if (x >= left && x <= right && y >= top && y <= bottom && end > start) {
      arcs.push({ start, length: end - start });
    }
  }
  let offset = directionRng() * arcs.reduce((sum, arc) => sum + arc.length, 0);
  for (const arc of arcs) {
    if (offset < arc.length) {
      const angle = arc.start + offset;
      return { x: fromX + Math.cos(angle) * distance, y: fromY + Math.sin(angle) * distance };
    }
    offset -= arc.length;
  }
  throw new Error("无法在测试区域内生成等距目标。");
}
