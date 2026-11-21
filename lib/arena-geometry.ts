export const MIN_ARENA_WIDTH = 320;
export const MIN_ARENA_HEIGHT = 180;

export function isArenaPlayable(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) &&
    width >= MIN_ARENA_WIDTH && height >= MIN_ARENA_HEIGHT;
}

export function arenaLayout(viewWidth: number, viewHeight: number, reference?: { w: number; h: number }) {
  const w = reference ? Math.max(MIN_ARENA_WIDTH, reference.w) : viewWidth;
  const h = reference ? Math.max(MIN_ARENA_HEIGHT, reference.h) : viewHeight;
  const scale = reference ? Math.min(viewWidth / w, viewHeight / h) : 1;
  const displayWidth = Math.min(viewWidth, w * scale);
  const displayHeight = Math.min(viewHeight, h * scale);
  return {
    w, h, scale, displayWidth, displayHeight,
    left: (viewWidth - displayWidth) / 2,
    top: (viewHeight - displayHeight) / 2,
  };
}

export function circleTouchesRect(
  x: number,
  y: number,
  radius: number,
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  const dx = Math.max(rect.left - x, x - rect.right, 0);
  const dy = Math.max(rect.top - y, y - rect.bottom, 0);
  return dx * dx + dy * dy <= radius * radius;
}
