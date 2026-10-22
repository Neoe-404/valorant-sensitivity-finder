"use client";

import { useEffect, useRef } from "react";
import { useAim, type ActiveTestApi } from "@/components/aim/AimArena";

/**
 * 统一的测试场景注册逻辑：
 * 四个测试组件（Flick / Tracking / Micro / Calibration）原本各自重复
 * apiRef + registerActive 的样板。这里集中处理，组件只需提供每帧的
 * onFrame / onPointerDown / onReset 回调。
 */
export function useActiveTest(api: ActiveTestApi): void {
  const { registerActive } = useAim();
  const apiRef = useRef(api);
  // 回调闭包每帧可能变化（引用最新），但注册只发生一次
  apiRef.current = api;

  useEffect(() => {
    registerActive({
      onFrame: (f, scene) => apiRef.current.onFrame(f, scene),
      onPointerDown: (x, y, scene) => apiRef.current.onPointerDown(x, y, scene),
      onReset: () => apiRef.current.onReset?.(),
    });
    return () => {
      registerActive(null);
    };
  }, [registerActive]);
}
