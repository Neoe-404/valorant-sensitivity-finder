"use client";

import { useCallback, useRef } from "react";

interface MouseSample {
  dx: number;
  dy: number;
  time: number;
}

interface MouseBatch {
  dx: number;
  dy: number;
  samples?: MouseSample[];
}

export function inputEventTime(event: Event): number {
  const now = performance.now();
  return event.timeStamp > 0 && event.timeStamp <= now ? event.timeStamp : now;
}

function appendMovement(batch: MouseBatch, event: MouseEvent, capturePath: boolean) {
  const dx = event.movementX || 0;
  const dy = event.movementY || 0;
  batch.dx += dx;
  batch.dy += dy;
  if (capturePath && (dx || dy)) {
    (batch.samples ??= []).push({ dx, dy, time: inputEventTime(event) });
  }
}

/**
 * 原始鼠标增量采集。
 * - movementX / movementY 写入 pending 缓冲区
 * - 浏览器 pointer 事件频率可能低于鼠标回报率：
 *   使用 getCoalescedEvents()（若可用）把合并事件累加，减少丢帧
 * - flush() 由 RAF 循环每帧调用一次，避免 React 重渲染
 */
export function useMouseTracking() {
  const pendingRef = useRef<MouseBatch>({ dx: 0, dy: 0 });

  const handleMove = useCallback((e: MouseEvent, capturePath = false) => {
    let coalesced: PointerEvent[] | undefined;
    try {
      coalesced = (e as PointerEvent).getCoalescedEvents?.();
    } catch {
      // 某些浏览器只提供外层事件的 movementX/Y。
    }
    const batch = pendingRef.current;
    if (coalesced?.some((sample) => sample.movementX || sample.movementY)) {
      for (const sample of coalesced) appendMovement(batch, sample, capturePath);
    } else {
      appendMovement(batch, e, capturePath);
    }
  }, []);

  const flush = useCallback(() => {
    const batch = pendingRef.current;
    pendingRef.current = { dx: 0, dy: 0 };
    return batch;
  }, []);

  return { pendingRef, handleMove, flush };
}
