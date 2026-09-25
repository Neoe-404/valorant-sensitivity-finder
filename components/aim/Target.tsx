/**
 * 目标绘制（Canvas）。
 * SceneTarget 是测试在场景里注册的圆形目标。
 */

export type TargetKind = "flick" | "track" | "micro" | "cal";

export interface SceneTarget {
  id: number;
  x: number;
  y: number;
  r: number;
  kind: TargetKind;
  born: number;
}

const COLORS: Record<TargetKind, { stroke: string; fill: string }> = {
  flick: { stroke: "#f43f4e", fill: "rgba(244,63,78,0.16)" },
  cal: { stroke: "#f43f4e", fill: "rgba(244,63,78,0.14)" },
  track: { stroke: "#eef2f6", fill: "rgba(238,242,246,0.10)" },
  micro: { stroke: "#52f485", fill: "rgba(82,244,133,0.16)" },
};

export function drawTarget(ctx: CanvasRenderingContext2D, t: SceneTarget, now: number): void {
  const { x, y, r, kind, born } = t;
  const c = COLORS[kind];
  // 出生放大动画（250ms）
  const age = (now - born) / 1000;
  const scale = age < 0.22 ? 0.5 + 0.5 * (age / 0.22) : 1;
  const rr = r * scale;

  ctx.save();
  if (kind === "track") {
    // 跟踪目标：带旋转缺口的光圈，方便观察是否“咬住”
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = c.stroke;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    const a0 = (now / 1000) % (Math.PI * 2);
    ctx.arc(x, y, rr, a0, a0 + Math.PI * 1.6);
    ctx.stroke();
    ctx.fillStyle = c.fill;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = c.fill;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.shadowColor = c.stroke;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
    // 中心点
    ctx.fillStyle = c.stroke;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
