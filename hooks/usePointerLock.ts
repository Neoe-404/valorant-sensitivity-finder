"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { acquirePointerLock } from "@/lib/pointer-lock";

/**
 * Pointer Lock 封装。
 * - 处理 pointerlockchange / pointerlockerror
 * - requestLock 返回是否成功（可处理用户拒绝/浏览器限制）
 * - 组件卸载时自动释放锁
 * - lockedRef 供 RAF 循环同步读取，locked state 供 UI 渲染
 */
export function usePointerLock<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [rawInput, setRawInput] = useState(false);
  const requestingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const element = ref.current;
    const onChange = () => {
      const isLocked = document.pointerLockElement === ref.current;
      lockedRef.current = isLocked;
      setLocked(isLocked);
    };
    document.addEventListener("pointerlockchange", onChange);
    document.addEventListener("pointerlockerror", onChange);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("pointerlockchange", onChange);
      document.removeEventListener("pointerlockerror", onChange);
      if (element && document.pointerLockElement === element) {
        document.exitPointerLock();
      }
    };
  }, [ref]);

  const requestLock = useCallback(async () => {
    const el = ref.current;
    if (!el || requestingRef.current) return false;
    requestingRef.current = true;
    try {
      const mode = await acquirePointerLock(el);
      if (!mountedRef.current || ref.current !== el) {
        if (document.pointerLockElement === el) document.exitPointerLock();
        return false;
      }
      const ok = mode !== null && document.pointerLockElement === el;
      lockedRef.current = ok;
      setLocked(ok);
      setRawInput(ok && mode === "raw");
      return ok;
    } finally {
      requestingRef.current = false;
    }
  }, [ref]);

  const exitLock = useCallback(() => {
    if (ref.current && document.pointerLockElement === ref.current) document.exitPointerLock();
  }, [ref]);

  return { locked, lockedRef, rawInput, requestLock, exitLock };
}
