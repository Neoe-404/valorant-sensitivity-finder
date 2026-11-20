export type PointerInputMode = "raw" | "adjusted";
type LockAttempt = "locked" | "failed" | "abandoned";

export function releaseOwnedLock(element: HTMLElement) {
  const doc = element.ownerDocument;
  if (doc.pointerLockElement === element) doc.exitPointerLock();
}

/** 支持 Promise 和旧式事件 API；只有目标元素真的获得锁才成功。 */
function attemptLock(element: HTMLElement, raw: boolean, signal?: AbortSignal): Promise<LockAttempt> {
  if (signal?.aborted || !element.isConnected) return Promise.resolve("abandoned");
  const doc = element.ownerDocument;
  return new Promise((resolve) => {
    let settled: LockAttempt | null = null;
    const finish = (outcome: LockAttempt) => {
      if (settled !== null) return;
      settled = outcome;
      clearTimeout(timeout);
      doc.removeEventListener("pointerlockchange", onChange);
      doc.removeEventListener("pointerlockerror", onError);
      signal?.removeEventListener("abort", onAbort);
      if (outcome === "abandoned") releaseOwnedLock(element);
      resolve(outcome);
    };
    const onChange = () => {
      if (doc.pointerLockElement === element) finish("locked");
    };
    const onError = () => finish("failed");
    const onAbort = () => finish("abandoned");
    const timeout = setTimeout(onAbort, 2000);
    doc.addEventListener("pointerlockchange", onChange);
    doc.addEventListener("pointerlockerror", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = raw
        ? element.requestPointerLock({ unadjustedMovement: true })
        : element.requestPointerLock();
      // Promise 晚于取消或超时时，只释放本次请求的目标。
      Promise.resolve(result).then(() => {
        if (settled === "abandoned") releaseOwnedLock(element);
        else onChange();
      }, onError);
    } catch {
      onError();
    }
  });
}

export async function acquirePointerLock(element: HTMLElement, signal?: AbortSignal): Promise<PointerInputMode | null> {
  const raw = await attemptLock(element, true, signal);
  if (signal?.aborted || !element.isConnected) {
    releaseOwnedLock(element);
    return null;
  }
  if (raw === "locked") return "raw";
  // 未知的超时状态可能还有原生请求在等待，不继续申请普通输入。
  if (raw === "abandoned") return null;
  const adjusted = await attemptLock(element, false, signal);
  if (signal?.aborted || !element.isConnected) {
    releaseOwnedLock(element);
    return null;
  }
  return adjusted === "locked" ? "adjusted" : null;
}
