import { afterEach, describe, expect, it, vi } from "vitest";
import { acquirePointerLock } from "../lib/pointer-lock";

function fixture(request: (raw: boolean, lock: () => void) => void | Promise<void>) {
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as HTMLElement | null });
  const exit = vi.fn(() => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event("pointerlockchange"));
  });
  Object.assign(doc, { exitPointerLock: exit });
  const element = {
    ownerDocument: doc,
    isConnected: true,
    requestPointerLock: vi.fn((options?: PointerLockOptions) => request(Boolean(options?.unadjustedMovement), () => {
      doc.pointerLockElement = element as unknown as HTMLElement;
      doc.dispatchEvent(new Event("pointerlockchange"));
    })),
  };
  return { element: element as unknown as HTMLElement, doc, request: element.requestPointerLock, exit };
}

afterEach(() => vi.useRealTimers());

describe("pointer lock acquisition", () => {
  it("releases a grant arriving after cancellation without trying adjusted input", async () => {
    let grant!: () => void;
    const f = fixture((_raw, lock) => new Promise<void>((resolve) => {
      grant = () => { lock(); resolve(); };
    }));
    const controller = new AbortController();
    const attempt = acquirePointerLock(f.element, controller.signal);
    controller.abort();
    grant();
    expect(await attempt).toBeNull();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledTimes(1);
    expect(f.doc.pointerLockElement).toBeNull();
  });

  it("ignores a lock change unrelated to the pending target", async () => {
    let grant!: () => void;
    const f = fixture((_raw, lock) => { grant = lock; });
    const attempt = acquirePointerLock(f.element);
    f.doc.dispatchEvent(new Event("pointerlockchange"));
    grant();
    expect(await attempt).toBe("raw");
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it("does not report success when both asynchronous requests reject", async () => {
    const f = fixture(() => Promise.reject(new Error("Denied")));
    expect(await acquirePointerLock(f.element)).toBeNull();
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.doc.pointerLockElement).toBeNull();
  });

  it("awaits a real lock when raw input is unsupported", async () => {
    const f = fixture(async (raw, lock) => {
      if (raw) throw new Error("NotSupportedError");
      await Promise.resolve();
      lock();
    });
    expect(await acquirePointerLock(f.element)).toBe("adjusted");
    expect(f.doc.pointerLockElement).toBe(f.element);
  });

  it("supports legacy APIs returning void and reporting success by event", async () => {
    const f = fixture((_raw, lock) => { queueMicrotask(lock); });
    expect(await acquirePointerLock(f.element)).toBe("raw");
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it("treats legacy error events as failure", async () => {
    const f = fixture(() => { queueMicrotask(() => f.doc.dispatchEvent(new Event("pointerlockerror"))); });
    expect(await acquirePointerLock(f.element)).toBeNull();
  });

  it("times out silent requests and removes its listeners", async () => {
    vi.useFakeTimers();
    const f = fixture(() => {});
    const remove = vi.spyOn(f.doc, "removeEventListener");
    const result = acquirePointerLock(f.element);
    await vi.runAllTimersAsync();
    expect(await result).toBeNull();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a grant that arrives after the request timed out", async () => {
    vi.useFakeTimers();
    let late!: () => void;
    const f = fixture((_raw, lock) => new Promise<void>((resolve) => {
      late = () => { lock(); resolve(); };
    }));
    const attempt = acquirePointerLock(f.element);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await attempt).toBeNull();
    late();
    await Promise.resolve();
    expect(f.exit).toHaveBeenCalledTimes(1);
    expect(f.doc.pointerLockElement).toBeNull();
  });

  it("leaves another target locked when a cancelled request resolves", async () => {
    let resolveRequest!: () => void;
    const f = fixture(() => new Promise<void>((resolve) => { resolveRequest = resolve; }));
    const controller = new AbortController();
    const attempt = acquirePointerLock(f.element, controller.signal);
    controller.abort();
    const other = {} as HTMLElement;
    f.doc.pointerLockElement = other;
    resolveRequest();
    expect(await attempt).toBeNull();
    expect(f.exit).not.toHaveBeenCalled();
    expect(f.doc.pointerLockElement).toBe(other);
  });
});
