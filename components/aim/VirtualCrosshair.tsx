/**
 * 虚拟准星：完全由程序绘制的准星。
 * 位置由 AimArena 使用 (movementX/Y × SensitivityMultiplier) 逐帧更新，
 * 与浏览器系统光标位置无关。
 */

export interface CrosshairOptions {
  color: string;
  /** 准星中心间隙 px */
  gap: number;
  /** 单条线长度 px */
  length: number;
  /** 线宽 px */
  thickness: number;
  /** 是否显示中心点 */
  dot: boolean;
  /** 中心点半径 px */
  dotRadius: number;
}

export const CROSSHAIR_DEFAULTS: CrosshairOptions = {
  color: "#52f485",
  gap: 3,
  length: 6,
  thickness: 2,
  dot: true,
  dotRadius: 1.5,
};

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts: CrosshairOptions = CROSSHAIR_DEFAULTS
): void {
  const { color, gap, length, thickness, dot, dotRadius } = opts;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = "square";
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;

  const inner = gap;
  const outer = gap + length;
  ctx.beginPath();
  // 上
  ctx.moveTo(x, y - inner);
  ctx.lineTo(x, y - outer);
  // 下
  ctx.moveTo(x, y + inner);
  ctx.lineTo(x, y + outer);
  // 左
  ctx.moveTo(x - inner, y);
  ctx.lineTo(x - outer, y);
  // 右
  ctx.moveTo(x + inner, y);
  ctx.lineTo(x + outer, y);
  ctx.stroke();

  if (dot) {
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
