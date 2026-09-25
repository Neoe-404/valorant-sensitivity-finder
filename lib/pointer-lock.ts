export type PointerInputMode = "raw" | "adjusted";

/** 支持 Promise 和旧式事件 API；只有目标元素真的获得锁才成功。 */
function attemptLock(element: HTMLElement, raw: boolean): Promise<boolean> {
  const doc = element.ownerDocument;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      doc.removeEventListener("pointerlockchange", onChange);
      doc.removeEventListener("pointerlockerror", onError);
      resolve(ok);
    };
    const onChange = () => finish(doc.pointerLockElement === element);
    const onError = () => finish(false);
    const timeout = setTimeout(() => finish(false), 2000);
    doc.addEventListener("pointerlockchange", onChange);
    doc.addEventListener("pointerlockerror", onError);
    try {
      const result = raw
        ? element.requestPointerLock({ unadjustedMovement: true })
        : element.requestPointerLock();
      // 无论最终采用事件还是 Promise，都消费异步拒绝。
      Promise.resolve(result).then(() => {
        if (doc.pointerLockElement === element) finish(true);
      }, onError);
    } catch {
      finish(false);
    }
  });
}

export async function acquirePointerLock(element: HTMLElement): Promise<PointerInputMode | null> {
  if (await attemptLock(element, true)) return "raw";
  if (!element.isConnected) return null;
  return await attemptLock(element, false) ? "adjusted" : null;
}
