"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { acquirePointerLock, releaseOwnedLock } from "@/lib/pointer-lock";

interface OwnedRequest {
  target: HTMLElement;
  controller: AbortController;
}

export function usePointerLock<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [rawInput, setRawInput] = useState(false);
  const ownedRef = useRef<OwnedRequest | null>(null);

  const ownsLock = useCallback(() => {
    const target = ownedRef.current?.target;
    return !!target?.isConnected && target.ownerDocument.pointerLockElement === target;
  }, []);

  const release = useCallback(() => {
    const owned = ownedRef.current;
    ownedRef.current = null;
    lockedRef.current = false;
    if (!owned) return;
    owned.controller.abort();
    releaseOwnedLock(owned.target);
    owned.target.remove();
  }, []);

  const exitLock = useCallback(() => {
    release();
    setLocked(false);
    setRawInput(false);
  }, [release]);

  useEffect(() => {
    const doc = ref.current?.ownerDocument;
    if (!doc) return;
    const onChange = () => {
      if (lockedRef.current && !ownsLock()) exitLock();
    };
    doc.addEventListener("pointerlockchange", onChange);
    return () => {
      doc.removeEventListener("pointerlockchange", onChange);
      release();
    };
  }, [ref, ownsLock, exitLock, release]);

  const requestLock = useCallback(async () => {
    const host = ref.current;
    if (!host?.isConnected || ownedRef.current) return false;

    // 独立目标可在取消后移除，避免晚到的锁被下一次请求误认。
    const target = host.ownerDocument.createElement("div");
    target.className = "pointer-events-none absolute inset-0";
    target.setAttribute("aria-hidden", "true");
    host.appendChild(target);
    const owned = { target, controller: new AbortController() };
    ownedRef.current = owned;

    const mode = await acquirePointerLock(target, owned.controller.signal);
    if (ownedRef.current !== owned) return false;
    if (!mode || !ownsLock()) {
      exitLock();
      return false;
    }

    lockedRef.current = true;
    setLocked(true);
    setRawInput(mode === "raw");
    return true;
  }, [ref, ownsLock, exitLock]);

  return { locked, lockedRef, rawInput, requestLock, exitLock, ownsLock };
}
