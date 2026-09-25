"use client";

import { useCallback, useRef } from "react";

/**
 * 原始鼠标增量采集。
 * - movementX / movementY 写入 pending 缓冲区
 * - 浏览器 pointer 事件频率可能低于鼠标回报率：
 *   使用 getCoalescedEvents()（若可用）把合并事件累加，减少丢帧
 * - flush() 由 RAF 循环每帧调用一次，避免 React 重渲染
 */
export function useMouseTracking() {
  const pendingRef = useRef({ dx: 0, dy: 0 });

  const handleMove = useCallback((e: MouseEvent) => {
    let dx = e.movementX || 0;
    let dy = e.movementY || 0;
    const pe = e as PointerEvent;
    if (typeof pe.getCoalescedEvents === "function") {
      try {
        const coalesced = pe.getCoalescedEvents();
        if (coalesced && coalesced.length > 0) {
          let sx = 0;
          let sy = 0;
          for (const c of coalesced) {
            sx += c.movementX || 0;
            sy += c.movementY || 0;
          }
          if (sx !== 0 || sy !== 0) {
            dx = sx;
            dy = sy;
          }
        }
      } catch {
        // 某些浏览器不支持，退回 movementX/Y
      }
    }
    pendingRef.current.dx += dx;
    pendingRef.current.dy += dy;
  }, []);

  const flush = useCallback(() => {
    const { dx, dy } = pendingRef.current;
    pendingRef.current = { dx: 0, dy: 0 };
    return { dx, dy };
  }, []);

  return { pendingRef, handleMove, flush };
}
